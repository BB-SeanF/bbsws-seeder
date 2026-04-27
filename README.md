# BBSWS Seeder

Browser-assisted Blackbaud school website seeding toolkit with a lightweight web runner.

## What This Repo Includes

- Seeder scripts for content types (`news`, `events`, `text`, `links`, `lists`, `downloads`, `photos`)
- Login/session bootstrap script
- Browser-based runner UI (`npm run web`)
- Source data JSON files in `data/`

## What This Repo Intentionally Excludes

The following are local/sensitive/generated and are ignored via `.gitignore`:

- `auth/` (saved login sessions)
- `node_modules/`
- `data/scraped/` outputs
- `error.png` failure screenshot artifact
- local report/log artifacts

## Requirements

- Node.js 18+
- npm
- Google Chrome installed (used by Playwright channel)

## Install

```bash
npm install
```

## Login Flow (creates local session state)

```bash
npm run login -- --school <schoolname> --profile <profile>
```

Example:

```bash
npm run login -- --school sisacademy --profile sean
```

This writes local auth state under `auth/<profile>/<school>.json` (ignored by git).

## Run the Web UI

```bash
npm run web
```

Then open:

- `http://localhost:4310`

## Run Seeders via CLI

Examples:

```bash
npm run seed:text -- --school <schoolname> --profile <profile> --headless --pre-check
npm run seed:links -- --school <schoolname> --profile <profile> --headless --pre-check
```

Run all seeders:

```bash
node scripts/seed-all.js --school <schoolname> --profile <profile> --headless --pre-check
```

## Data Files

Primary seed inputs live in:

- `data/news.json`
- `data/events.json`
- `data/text.json`
- `data/links.json`
- `data/lists.json`
- `data/downloads.json`
- `data/photos.json`
