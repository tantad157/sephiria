# Sephiria Codex

A small **for-fun, private** reference site: weapon trees and artifacts from game data I exported from a spreadsheet. Nothing official—just something nice to click through when theorycrafting or checking upgrades.

## Run it locally

Static site—needs a real HTTP server (browser `fetch` will not work from a raw file path):

```bash
npx --yes serve .
```

Open the URL it prints (often `http://localhost:3000`).

## Refresh the data

When the sheet changes: export **Weapons** and **Artifacts** as HTML, drop them in the project root with the **`resources/`** folder (those little cell icons), then:

```bash
npm run extract
```

That rebuilds `data/weapons.json` and `data/artifacts.json`. Optional: `npm run prune-images` trims unused images in `resources/` to match the JSON.

## What’s where

| Path | What |
|------|------|
| `index.html`, `styles.css`, `app.js` | The UI |
| `data/*.json` | Parsed codex data (generated) |
| `scripts/` | Extract + helper scripts |
| `Weapons.html`, `Artifacts.html` | Raw exports (optional to keep in git) |

---

*Private toy project—use it however you like.*
