# Football Pulse Live-Score API Edition

## Replace your GitHub files

Upload these files to the root of the `football-pulse` repository and replace the older versions:

- `index.html`
- `styles.css`
- `app.js`
- `server.js`
- `logo.svg`
- `package.json`

## Render settings

Build command:

```text
npm install
```

Start command:

```text
npm start
```

## Render environment variables

Open **Render → football-pulse → Environment** and add:

```text
LIVE_SCORE_API_KEY
```

Paste your Live-Score API key as the value.

Then add:

```text
LIVE_SCORE_API_SECRET
```

Paste your Live-Score API secret as the value.

Never put the real key or secret into GitHub.

## Test

After Render says Live, open:

```text
https://footballpulse.co.uk/api/health
```

You should see:

```json
{"ok":true,"credentialsConfigured":true}
```

Then open:

```text
https://footballpulse.co.uk/api/live
```

The live endpoint only returns matches currently being played. An empty `matches` array is normal when there are no live games.


## Results and highlights page

The update adds:

- `results.html`
- `results.css`
- `results.js`
- `highlights.json`
- `/api/results` in `server.js`

Open the page at:

```text
https://footballpulse.co.uk/results.html
```

### Adding official highlights

Open `highlights.json`. Replace an empty `videoId` with the ID from an official YouTube video.

For example, from:

```text
https://www.youtube.com/watch?v=ABC123xyz
```

use:

```json
"videoId": "ABC123xyz"
```

Use videos from official leagues, clubs, tournaments, broadcasters or other rights holders. Do not upload or embed unlicensed match footage.


## Full World Cup predictor

The update adds:

- `predictions.html`
- `predictions.css`
- `predictions.js`
- `world-cup-groups.json`

Open it at:

```text
https://footballpulse.co.uk/predictions.html
```

It includes all 12 groups, selection of eight best third-place teams, Round of 32, Round of 16, quarter-finals, semi-finals, third-place play-off and final. Predictions are saved in the visitor's browser using local storage.


## Live scorecard upgrade

This version adds:

- A safer score parser for `0-0`, `0 – 0`, nested score objects and separate home/away score fields.
- Animated live cards using colours based on each team.
- Goalscorers and goal minutes on the live card when the provider supplies them.
- A dedicated goalscorers section in the match centre.
- More flexible parsing for statistics, events, incidents, goals and timelines.
- Clear notices when a competition or subscription does not provide detailed statistics.

Replace `server.js`, `app.js` and `styles.css`, or upload the complete package.
