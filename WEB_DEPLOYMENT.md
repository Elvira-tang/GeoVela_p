# GeoVela web preview

This is a browser-only map preview. Visitors can load supported local GIS files and inspect layers. Their files stay in their browser session; reloading clears imported layers. The Python agent, workspaces, and server-side analysis are not included.

## Publish with GitHub Pages

1. Push the `codex/web-mvp` branch to `Elvira-tang/GeoVela`.
2. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
3. Open **Actions → Publish GeoVela web preview** and confirm the deployment succeeds. The workflow also runs on later pushes to `main`.
4. Visit `https://elvira-tang.github.io/GeoVela/`. Share that URL or encode it in a QR code.

The web build is `npm run build:web`. It writes `dist/index.html` with assets under `/GeoVela/`. The existing `npm run build` continues to build the Electron desktop app.
