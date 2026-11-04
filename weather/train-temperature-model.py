"""Train a transparent 1–3 day maximum-temperature bias-correction baseline."""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
FORECAST_PATH = ROOT / "public" / "data" / "weather" / "forecast-sample.json"
OUTPUT_PATH = ROOT / "public" / "data" / "weather" / "model-predictions.json"
CACHE_DIR = ROOT / "weather" / ".cache"
TRAINING_START = date(2025, 1, 1)
VALIDATION_DAYS = 120
RIDGE_ALPHA = 3.0


def fetch_json(url: str, cache_name: str):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / cache_name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    request = urllib.request.Request(url, headers={"User-Agent": "GeoVela weather research demo"})
    with urllib.request.urlopen(request, timeout=180) as response:
        data = json.load(response)
    path.write_text(json.dumps(data), encoding="utf-8")
    return data


def api_url(base: str, params: dict[str, str]) -> str:
    return f"{base}?{urllib.parse.urlencode(params, safe=',')}"


def daily_hourly_max(hourly: dict, variable: str) -> dict[str, float]:
    grouped: dict[str, list[float]] = {}
    for timestamp, value in zip(hourly["time"], hourly[variable], strict=True):
        if value is not None:
            grouped.setdefault(timestamp[:10], []).append(float(value))
    return {day: max(values) for day, values in grouped.items() if values}


def day_features(day: str, raw_value: float, recent_bias: float) -> list[float]:
    target = date.fromisoformat(day)
    angle = 2 * math.pi * target.timetuple().tm_yday / 365.25
    return [raw_value, math.sin(angle), math.cos(angle), recent_bias]


def fit_ridge(features: np.ndarray, target: np.ndarray):
    mean = features.mean(axis=0)
    scale = features.std(axis=0)
    scale[scale < 1e-8] = 1.0
    normal = (features - mean) / scale
    design = np.column_stack([np.ones(len(normal)), normal])
    penalty = np.eye(design.shape[1]) * RIDGE_ALPHA
    penalty[0, 0] = 0
    coefficients = np.linalg.solve(design.T @ design + penalty, design.T @ target)
    return mean, scale, coefficients


def predict_ridge(model, features: np.ndarray) -> np.ndarray:
    mean, scale, coefficients = model
    normal = (features - mean) / scale
    design = np.column_stack([np.ones(len(normal)), normal])
    return design @ coefficients


def round_or_none(value: float | None, digits: int = 2):
    return None if value is None or not math.isfinite(value) else round(value, digits)


def main() -> None:
    live = json.loads(FORECAST_PATH.read_text(encoding="utf-8"))
    cities = live["cities"]
    latitudes = ",".join(str(city["latitude"]) for city in cities)
    longitudes = ",".join(str(city["longitude"]) for city in cities)
    # Reanalysis is delayed by several days; leave a seven-day buffer.
    training_end = date.today() - timedelta(days=7)
    common = {
        "latitude": latitudes,
        "longitude": longitudes,
        "start_date": TRAINING_START.isoformat(),
        "end_date": training_end.isoformat(),
        "timezone": "Asia/Shanghai",
    }
    actual = fetch_json(api_url("https://archive-api.open-meteo.com/v1/archive", {
        **common, "daily": "temperature_2m_max",
    }), f"actual-{TRAINING_START}-{training_end}.json")
    def fetch_previous(item):
        index, city = item
        params = {
            "latitude": str(city["latitude"]),
            "longitude": str(city["longitude"]),
            "start_date": TRAINING_START.isoformat(),
            "end_date": training_end.isoformat(),
            "timezone": "Asia/Shanghai",
            "hourly": ",".join(f"temperature_2m_previous_day{h}" for h in (1, 2, 3)),
        }
        return fetch_json(
            api_url("https://previous-runs-api.open-meteo.com/v1/forecast", params),
            f"previous-runs-{index:02d}-{TRAINING_START}-{training_end}.json",
        )

    with ThreadPoolExecutor(max_workers=5) as executor:
        previous = list(executor.map(fetch_previous, enumerate(cities)))
    if not isinstance(actual, list):
        actual = [actual]
    if not isinstance(previous, list):
        previous = [previous]
    if len(actual) != len(cities) or len(previous) != len(cities):
        raise RuntimeError("Weather API city count does not match the live sample")

    city_outputs = []
    all_raw_errors: list[float] = []
    all_model_errors: list[float] = []
    for index, city in enumerate(cities):
        actual_by_day = dict(zip(actual[index]["daily"]["time"], actual[index]["daily"]["temperature_2m_max"], strict=True))
        predictions = []
        horizon_metrics = []
        for horizon in (1, 2, 3):
            raw_by_day = daily_hourly_max(previous[index]["hourly"], f"temperature_2m_previous_day{horizon}")
            days = sorted(day for day in set(actual_by_day) & set(raw_by_day) if actual_by_day[day] is not None)
            residuals = [float(actual_by_day[day]) - raw_by_day[day] for day in days]
            rows: list[list[float]] = []
            targets: list[float] = []
            usable_days: list[str] = []
            for position in range(30, len(days)):
                recent_bias = float(np.mean(residuals[position - 30:position]))
                rows.append(day_features(days[position], raw_by_day[days[position]], recent_bias))
                targets.append(residuals[position])
                usable_days.append(days[position])
            if len(rows) < VALIDATION_DAYS * 2 + 60:
                raise RuntimeError(f"Not enough history for {city['name']} horizon {horizon}")
            x = np.asarray(rows, dtype=float)
            y = np.asarray(targets, dtype=float)
            selection_start = len(x) - VALIDATION_DAYS * 2
            test_start = len(x) - VALIDATION_DAYS
            selection_model = fit_ridge(x[:selection_start], y[:selection_start])
            selection_correction = predict_ridge(selection_model, x[selection_start:test_start])
            selection_raw_mae = float(np.mean(np.abs(y[selection_start:test_start])))
            selection_model_mae = float(np.mean(np.abs(y[selection_start:test_start] - selection_correction)))
            correction_enabled = selection_model_mae < selection_raw_mae
            test_model = fit_ridge(x[:test_start], y[:test_start])
            test_correction = predict_ridge(test_model, x[test_start:]) if correction_enabled else np.zeros(VALIDATION_DAYS)
            raw_mae = float(np.mean(np.abs(y[test_start:])))
            model_mae = float(np.mean(np.abs(y[test_start:] - test_correction)))
            all_raw_errors.extend(np.abs(y[test_start:]).tolist())
            all_model_errors.extend(np.abs(y[test_start:] - test_correction).tolist())
            final_model = fit_ridge(x, y)
            live_day = city["forecast"][horizon - 1]
            latest_bias = float(np.mean(residuals[-30:]))
            live_features = np.asarray([day_features(live_day["date"], float(live_day["maxTemperatureC"]), latest_bias)])
            correction = float(predict_ridge(final_model, live_features)[0]) if correction_enabled else 0.0
            predictions.append({
                "date": live_day["date"],
                "horizonDays": horizon,
                "openMeteoMaxC": live_day["maxTemperatureC"],
                "modelMaxC": round(float(live_day["maxTemperatureC"]) + correction, 1),
                "correctionC": round(correction, 1),
            })
            horizon_metrics.append({
                "horizonDays": horizon,
                "sampleCount": len(rows),
                "testStart": usable_days[test_start],
                "correctionEnabled": correction_enabled,
                "rawMaeC": round(raw_mae, 2),
                "modelMaeC": round(model_mae, 2),
            })
        city_outputs.append({"name": city["name"], "predictions": predictions, "validation": horizon_metrics})

    aggregate_raw = float(np.mean(all_raw_errors))
    aggregate_model = float(np.mean(all_model_errors))
    output = {
        "generatedAt": live["generatedAt"],
        "trainingPeriod": {"start": TRAINING_START.isoformat(), "end": training_end.isoformat()},
        "method": "Per-city ridge regression bias correction using raw forecast, annual seasonality and trailing 30-day forecast bias",
        "validation": {
            "scheme": f"Earlier {VALIDATION_DAYS}-sample selection window chooses whether to apply correction; last {VALIDATION_DAYS} samples are the untouched test window",
            "rawMaeC": round_or_none(aggregate_raw),
            "modelMaeC": round_or_none(aggregate_model),
            "improvementPercent": round_or_none((aggregate_raw - aggregate_model) / aggregate_raw * 100),
            "beatsRawForecast": aggregate_model < aggregate_raw,
        },
        "cities": city_outputs,
    }
    OUTPUT_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(city_outputs)} city models; validation MAE {aggregate_raw:.2f}°C -> {aggregate_model:.2f}°C")


if __name__ == "__main__":
    main()
