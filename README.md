# Football Pulse Multi-Source Edition

A responsive animated football scores website that merges matches from several providers, removes duplicates and labels every score with its source.

## Supported score providers

- football-data.org
- TheSportsDB
- API-Football by API-Sports
- Sportmonks

The site requests every configured provider in parallel. If two providers return the same match, Football Pulse merges them into one card and lists both source names. If a provider fails, the others keep working.

BBC Sport is used through its official football RSS feed for headlines. BBC does not provide a public third-party live-score API, so BBC pages are not scraped.

## Run it

Install Node.js 18 or newer, open a terminal in this folder and add one or more keys.

### macOS / Linux

```bash
FOOTBALL_DATA_TOKEN="your_key" \
THESPORTSDB_KEY="your_key" \
API_FOOTBALL_KEY="your_key" \
SPORTMONKS_TOKEN="your_key" \
npm start
```

### Windows PowerShell

```powershell
$env:FOOTBALL_DATA_TOKEN="your_key"
$env:THESPORTSDB_KEY="your_key"
$env:API_FOOTBALL_KEY="your_key"
$env:SPORTMONKS_TOKEN="your_key"
npm start
```

You do not need all four keys. One is enough, while several provide wider coverage and backup feeds.

Open `http://localhost:3000`.

## Important

- API keys stay on the Node.js server and are never placed in browser JavaScript.
- Each provider has its own coverage, limits and licence. Check its terms before publishing the site commercially.
- Refreshing is set to once per minute to reduce rate-limit problems.
- Without any configured key, the website displays clearly labelled demonstration data.


## FotMob upcoming fixtures

The **Coming Up** section uses FotMob's website match-data endpoint through the local Node server. No FotMob API key is needed. FotMob does not advertise this endpoint as a public developer API, so it may change or stop working. The page handles failures gracefully and keeps the other score providers running. For a production or commercial service, obtain permission or use a licensed fixtures API.

## Real scores and breaking news

The main score centre now tries FotMob first, so it can display real live, finished and scheduled scores without an API key. Optional provider keys add backup coverage and duplicate checking.

The breaking-news wire combines publisher RSS feeds from BBC Sport, The Guardian and ESPN. Every card links to the original publisher. News refreshes every three minutes and scores every minute.

FotMob does not advertise its website endpoint as a public developer API. If it changes or blocks a request, configure one or more optional score providers listed above as backups.
