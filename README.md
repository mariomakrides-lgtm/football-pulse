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
