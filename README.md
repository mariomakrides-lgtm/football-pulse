# Football Pulse Live

A complete replacement build for the Football Pulse website.

## Files to upload to GitHub

Upload all six files in this folder to the root of your repository:

- `index.html`
- `styles.css`
- `app.js`
- `server.js`
- `package.json`
- `README.md`

Replace the older versions.

## Render settings

- Build command: `npm install`
- Start command: `npm start`
- Auto Deploy: On

## Required environment variable

In Render, open **Environment** and add:

`API_FOOTBALL_KEY`

Paste your API-Football key as the value.

This enables:

- live scores
- match events
- possession
- shots
- corners
- fouls
- cards
- line-ups
- real-time match detail updates

## Optional backup provider

You can also add:

`FOOTBALL_DATA_TOKEN`

This provides backup scores and fixtures, but not the same detailed live statistics.

## Refresh timings

- Scores: every 15 seconds
- Open match statistics: every 15 seconds
- Fixtures: every 5 minutes
- News: every 3 minutes

The provider's API plan must allow this number of requests.
