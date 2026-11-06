# Show and Movie Tracker

A simple personal app for keeping track of the movies and TV shows you want to watch. Search for a title, add it to your library, and it shows up as a poster. Each title gets a label (**Planned**, **Watching** or **Watched**), and for shows it also remembers which season and episode you're on and when the next one comes out.

There's no login and no server to sign up for. Everything is saved to a JSON file on your own computer.

## Tech
- **Frontend:** plain JavaScript, HTML and CSS (no build step)
- **Backend:** Node.js with Express
- **Data:** [TMDB](https://www.themoviedb.org/) API for search, posters and episode info
- **Storage:** local JSON file (`data/library.json`)

## How to run
1. Install [Node.js](https://nodejs.org/) 22.9 or newer.
2. Get a free TMDB API key: make an account, then go to **Settings → API** at https://www.themoviedb.org/settings/api. Either the "API Key" or the "API Read Access Token" works.
3. Install the dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env` and paste your key in:
   ```
   TMDB_API_KEY=your_key_here
   ```
5. Start the app:
   ```bash
   npm start
   ```
6. Open http://localhost:3000 in your browser.

The first time it runs, it creates an empty `data/library.json`. After that it loads whatever is in that file, so back it up or copy it to another computer to keep your list.

## Features
- Search for any movie or TV show and add it with one click
- Poster grid of everything you've added, with filters for Watching, Planned, Watched, Movies and Shows
- Labels on each title instead of separate lists: movies use Planned/Watched, shows use Planned/Watching/Watched
- Season and episode tracking for shows, with a button to mark the next episode watched
- Shows how many aired episodes you have left
- Next release info for shows:
  - the exact date when the next episode is scheduled
  - an estimate for the next season based on how far apart past seasons premiered
  - "Ended" when the show is over (you can also mark a show as ended yourself)
- Show info refreshes from TMDB automatically once a day

## Tests
```bash
npm test
```
The tests use a fake version of TMDB, so they don't need an API key or internet connection.
