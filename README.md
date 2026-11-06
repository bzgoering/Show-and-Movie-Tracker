# Show and Movie Tracker

A simple personal app for keeping track of the movies and TV shows you want to watch. Search for a title, add it to your library, and it shows up as a poster. Each title gets a label (**Planned**, **Watching** or **Watched**), and for shows it also remembers which season and episode you're on and when the next one comes out.

There's no login and no server to sign up for. Everything is saved to a JSON file on your own computer.

## Tech
- **Frontend:** plain JavaScript, HTML and CSS (no build step)
- **Backend:** Node.js with Express
- **Data:** [TMDB](https://www.themoviedb.org/) API for search, posters, episode info, recommendations and streaming services
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
- Sort the All tab by A–Z (default), progress (Watching → Waiting → Planned → Watched) or release date (newest first)
- Pick a genre on the All tab to see only titles in it. The list only has genres from your own library.
- Search your own library by title (finds titles under any label, and ignores accents and punctuation)
- Poster grid of everything you've added, with filters for Watching, Waiting, Planned, Watched, Movies and Shows
- **Waiting** holds shows you're caught up on that still have episodes or seasons coming. When a new episode comes out, the show moves back to Watching on its own.
- If a show that ended comes back (renewed, revived or rebranded), it's moved out of Watched on the next start and shows up under Waiting again
- Labels on each title instead of separate lists: movies use Planned/Watched, shows use Planned/Watching/Watched
- Season and episode tracking for shows: pick the episode you're on (only episodes that have aired are listed), or "Caught up"
- One-click buttons to mark the episode you're on as watched, or jump straight to the newest episode
- On the last episode of a show that has ended, the button becomes **Done**, which marks it watched and moves the show to Watched
- "What's next" for each show, labeled so it's clear what's coming:
  - **Next episode**: for weekly shows, the date of the next episode and when the season finale airs
  - **Next season**: the premiere date, and whether the whole season drops at once or comes out weekly
  - **Next season (estimate)**: if nothing is announced, a guess based on how far apart past seasons came out
  - **Series ended**: when the show is over (you can also mark a show as ended yourself)
- **Planned** titles show where you can watch them (streaming services on the card, plus stream/rent/buy options in the details), for the country set in Explore
- Every time the app starts, it updates all your saved titles from TMDB first, so you never see old info. If TMDB can't be reached, it shows your saved info instead.

## Explore
The **Explore** tab suggests movies and shows you'll probably like, best match first. It looks at the genres you watch most, whether you lean toward movies or shows, which of your titles TMDB recommends things for, and ratings. Titles you've watched count more than ones you've only planned.

- Each suggestion shows a match score, why it was suggested, and where it's streaming
- Tabs for **All**, **Movies**, **Live-action shows** and **Anime & cartoons** (shows TMDB tags as Animation)
- Click **Streaming** to pick the services you have, and Explore will only suggest titles on them. Your picks and country are saved in `data/library.json`.
- Set your country with the Country picker (or `WATCH_REGION` in `.env`, default `US`)
- Add a suggestion straight from its details: **Add to Planned** to watch later, or **Watched** if you've already seen it (shows are marked caught up)
- Not interested in something? Click the ✕ on its poster (or **Not interested** in its details). It's hidden for good, and Explore suggests a little less like it. Undo right away, or bring titles back from the **hidden** list.

**How Explore learns.** Your library is the main signal. Hidden titles act as a counterweight, not a veto: a genre only counts against a suggestion as far as you hide it more than you watch it, and titles similar to ones you hid get a small penalty. Every add and hide from Explore is saved with what the score was based on. Once you've added at least 3 suggestions and hidden at least 2, Explore compares the two groups and shifts weight toward the signals that predicted your adds (each by at most half). The line above the suggestions shows your picks and hit rate, and says "tuned to your picks" once this is active.

Streaming info comes from [JustWatch](https://www.justwatch.com/) through TMDB.

## Tests
```bash
npm test
```
The tests use a fake version of TMDB, so they don't need an API key or internet connection.
