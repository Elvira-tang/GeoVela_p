# GeoVela browser edition

Visitors can load supported local GIS files, adjust layer styles, inspect and export vector attributes as CSV, export the current map as PNG or JPG, and create a layout with a legend, scale bar, north arrow, and text for PNG export. Their files stay in their browser session; reloading clears imported layers and layouts. The Python agent, workspaces, and server-side analysis are not included.

## Publish with GitHub Pages

1. Push the tested web changes to `main` in `Elvira-tang/GeoVela`.
2. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Open **Actions → Publish GeoVela web** and confirm the deployment succeeds. The workflow runs on later pushes to `main`.
4. Visit `https://elvira-tang.github.io/GeoVela/`. Share that URL or encode it in a QR code.

The web build is `npm run build:web`. It writes `dist/index.html` with assets under `/GeoVela/`. The existing `npm run build` continues to build the Electron desktop app.
