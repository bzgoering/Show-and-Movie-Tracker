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

## Updating

```bash
git pull
npm install
```

Then restart the app (Ctrl+C in its window, then `npm start`). The page picks up changes on its own, but the server keeps running the old code until it's restarted.

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

The **Explore** tab suggests movies and shows you'll probably like, best match first. It looks at which of your titles TMDB recommends things for, the genres and languages you watch, whether you lean toward movies or shows, and ratings.

- Each suggestion shows a match %, why it was suggested (in its details), and where it's streaming. With an empty library, Explore asks you to add a show or movie first.
- Tabs follow what's in your library, so a tab only appears once you have that kind of title:
  - **Movies** once you have a movie
  - **Shows** while your shows are all live action, or all anime & cartoons (TMDB's Animation genre)
  - **Live-action shows** and **Anime & cartoons** once you have both kinds of show
  - **All** when there's more than one tab
  - On **Movies**, an **All movies / Live action / Anime & cartoons** picker once you have both kinds of movie
- Filter by **genre**. The list only has genres from your own library, with movie and show genres lined up (TV's "Sci-Fi & Fantasy" counts as Science Fiction and Fantasy). Filtering narrows the list but doesn't change anyone's match %, and Explore searches that genre too so the list stays full.
- Click **Streaming** to pick the services you have, and Explore will only suggest titles on them. Your picks and country are saved in `data/library.json`.
- Set your country with the Country picker (or `WATCH_REGION` in `.env`, default `US`)
- Add a suggestion straight from its details: **Add to Planned** to watch later, or **Watched** if you've already seen it (shows are marked caught up)
- Not interested in something? Click the ✕ on its poster (or **Not interested** in its details). It's hidden for good, and Explore suggests a little less like it. Undo right away, or bring titles back from the **hidden** list.

**How much each title in your library counts.** Explore looks at what you've actually done with each title, not just its label:

- A show you finished (or are caught up on, including **Waiting**) counts most. A movie you watched counts a little less, since it's a smaller commitment.
- A show you're partway through counts more the further in you are.
- A show that looks dropped (stuck near the start and untouched for two months) barely counts, and isn't used to find suggestions. If you never set episodes on any show, this check is skipped.
- Planned titles show what you're curious about, so they count a little. Ones you saved from Explore count even less, so Explore doesn't just hear its own suggestions back.

**What the match % means.** It's how strongly your library points to a title, so it means the same thing on every tab:

- **85% and up (strong match):** several titles you love point to it, or one does and it closely fits what you watch.
- **70–84% (good match):** a show you finished or are well into, or a movie you watched, points to it.
- **50–69% (possible match):** only weaker signs point to it, such as titles you've saved, or it's popular and close to the genres you watch.
- **Below 50% (long shot):** little in common with your library.

How it's worked out:

- **Recommendations** are the strongest sign. Each of your titles that TMDB says is similar adds to the score, weighted by how much that title counts (see above). More titles pointing to the same suggestion add up, with diminishing returns. Saved titles together never count for more than two of them.
- **Genres** come next: how closely a title's genres match the ones you watch most, using your movie genres for movies and your show genres for shows. A close genre match on its own is a decent sign but never a strong one, and counts less while your library is small. Drama is on about half of everything, so it counts as half a genre.
- **Trims:** a below-par rating takes up to 30% off (ratings with few votes are trusted less; a great rating keeps the score but doesn't add to it). A type you rarely watch (movies vs shows), or a language you never watch, takes up to 10% off each.
- Every title starts at 10%, because with nothing for or against it, anyone might like it. The top is 99%: Explore is never certain.
- Titles that haven't come out yet are left out.

**How Explore learns.** Your library is the main signal. Hidden titles act as a counterweight, not a veto: a genre only counts against a suggestion as far as you hide it more than you watch it, and titles similar to ones you hid get a small penalty. Every add and hide from Explore is saved with what the score was based on. Once you've added at least 3 suggestions and hidden at least 2, Explore compares the two groups and shifts weight toward the signals that predicted your adds (each by at most half). After 10 picks (at least 3 adds and 3 hides), it also checks its numbers against what you do: if the suggestions you acted on averaged 80% but you added only 4 in 10, every match comes down a little (half the gap, at most 10 points), and the other way round if you add more than the numbers suggest. The order doesn't change. The line above the suggestions shows your picks and hit rate, and says "tuned to your picks" once either of these is active.

Streaming info comes from [JustWatch](https://www.justwatch.com/) through TMDB.

## Development

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `npm run dev`    | Starts the app and restarts it when server files change             |
| `npm test`       | Runs the tests (they use a fake TMDB, so no key or internet needed) |
| `npm run lint`   | Checks the code with ESLint                                         |
| `npm run format` | Formats everything with Prettier                                    |
| `npm run check`  | Lint, formatting check and tests together. Run before committing.   |

### Project structure

```
server/
  index.js            starts the app (reads .env, opens data/library.json)
  app.js              wires the routes together; errors become JSON responses
  routes/             the /api endpoints: library, explore, settings
  library/items.js    rules for library titles (create, change, merge TMDB updates)
  library/sync.js     refreshes titles from TMDB without blocking saves
  explore/            suggestions: taste.js (your library), score.js (the match %),
                      build.js (gathering from TMDB), feedback.js (your picks)
  predict.js          when a show's next episode or season comes out
  release.js          weekly vs whole-season releases
  tmdb.js             the TMDB API client (the key never leaves the server)
  store.js            reads and writes data/library.json safely
public/
  index.html, styles.css
  shared/             code used by both the page and the server (episode progress, labels)
  js/main.js          starts the page
  js/library/         the Library page: store.js (your library in the browser), page.js, detail.js
  js/explore/         the Explore page and its streaming-services panel
  js/lib/             small helpers (API calls, dates, the router, the details pop-up)
test/                 node:test tests, with a fake TMDB in fake-tmdb.js
```
