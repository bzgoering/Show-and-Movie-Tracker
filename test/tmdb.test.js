// Runs the real TMDB client against a stubbed fetch, using response shapes from the TMDB docs.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as tmdb from '../server/tmdb.js';

const realFetch = globalThis.fetch;
let requests;

function stub(routes) {
  requests = [];
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    requests.push({ path: u.pathname, auth: opts.headers.Authorization, apiKey: u.searchParams.get('api_key') });
    const body = routes[u.pathname];
    if (!body) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

beforeEach(() => { process.env.TMDB_API_KEY = 'abc123'; });
afterEach(() => { globalThis.fetch = realFetch; delete process.env.TMDB_API_KEY; });

const show = {
  id: 1, name: 'Weekly Show', first_air_date: '2024-10-01', poster_path: '/p.jpg', overview: '', status: 'Returning Series', in_production: true,
  number_of_seasons: 2, number_of_episodes: 18, last_air_date: '2026-11-06',
  last_episode_to_air: { season_number: 2, episode_number: 6, air_date: '2026-11-06', name: 'Six' },
  next_episode_to_air: { season_number: 2, episode_number: 7, air_date: '2026-11-13', name: 'Seven' },
  seasons: [
    { season_number: 0, name: 'Specials', episode_count: 2, air_date: null },
    { season_number: 1, name: 'Season 1', episode_count: 8, air_date: '2024-10-01' },
    { season_number: 2, name: 'Season 2', episode_count: 10, air_date: '2026-10-02' },
  ],
};
const weeklySeason = { episodes: Array.from({ length: 10 }, (_, i) => ({ episode_number: i + 1, air_date: `2026-${String(10 + Math.floor((2 + i * 7) / 31)).padStart(2, '0')}-${String(((2 + i * 7) % 31) || 1).padStart(2, '0')}` })) };

test('TV details include the release pattern of the airing season', async () => {
  stub({ '/3/tv/1': show, '/3/tv/1/season/2': weeklySeason });
  const d = await tmdb.getDetails('tv', 1);
  assert.equal(d.cache.release.pattern, 'weekly');
  assert.equal(d.cache.release.season, 2);
  assert.equal(d.cache.release.finale.episode, 10);
  assert.deepEqual(d.cache.seasons.map((s) => s.season), [1, 2], 'specials are left out');
  assert.equal(d.cache.nextEpisode.episode, 7);
  assert.equal(requests[0].apiKey, 'abc123');
});

test('falls back to the previous season when the new one has no dates yet', async () => {
  const binge = { ...show, next_episode_to_air: { season_number: 3, episode_number: 1, air_date: '2027-03-05', name: '' } };
  stub({
    '/3/tv/1': binge,
    '/3/tv/1/season/3': { episodes: [{ episode_number: 1, air_date: '2027-03-05' }, { episode_number: 2, air_date: null }] },
    '/3/tv/1/season/2': { episodes: Array.from({ length: 8 }, (_, i) => ({ episode_number: i + 1, air_date: '2025-06-01' })) },
  });
  const d = await tmdb.getDetails('tv', 1);
  assert.equal(d.cache.release.pattern, 'all-at-once');
  assert.equal(d.cache.release.basedOnSeason, 2);
});

test('a failed season lookup does not stop the show from being added', async () => {
  stub({ '/3/tv/1': show });
  const d = await tmdb.getDetails('tv', 1);
  assert.equal(d.title, 'Weekly Show');
  assert.equal(d.cache.release, null);
});

test('long read access tokens are sent as a Bearer header', async () => {
  process.env.TMDB_API_KEY = '"eyJ' + 'x'.repeat(60) + '"';
  stub({ '/3/search/multi': { results: [{ id: 5, media_type: 'movie', title: 'M', release_date: '2020-01-01' }, { id: 6, media_type: 'person', name: 'P' }] } });
  const r = await tmdb.search('m');
  assert.equal(r.length, 1, 'people are filtered out');
  assert.equal(requests[0].auth, 'Bearer eyJ' + 'x'.repeat(60));
  assert.equal(requests[0].apiKey, null);
});
