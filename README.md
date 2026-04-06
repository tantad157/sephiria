# Sephiria Codex

Static reference site for weapon upgrade trees and artifacts. Built for [GitHub Pages](https://pages.github.com/) (free hosting).

## View locally

Serve the folder over HTTP (not `file://` open, or `fetch` will fail):

```bash
npx --yes serve .
```

Then open the URL shown (e.g. `http://localhost:3000`).

## Regenerate data

Export the sheet as HTML (`Weapons.html`, `Artifacts.html`) and keep the `resources/` folder next to them (icons are stored as images there). Then:

```bash
npm run extract
```

This writes `data/weapons.json` and `data/artifacts.json`.

## GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main** (or **master**), folder **`/ (root)`**.
3. After the build, the site is at `https://<user>.github.io/<repo>/`.

If the site does not load JSON, ensure `data/*.json` and `index.html` are at the repo root.

## Layout

- `index.html` — shell
- `styles.css` — dark theme
- `app.js` — loads JSON and renders UI
- `data/` — generated JSON (run `npm run extract`)
- `Weapons.html` / `Artifacts.html` — source exports (optional in repo)
