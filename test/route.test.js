import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeQuery, parseHash, searchHash } from '../public/shared/route.js';

test('pages and sub-tabs are read from the address', () => {
  assert.deepEqual(parseHash(''), { view: 'library', sub: 'all' });
  assert.deepEqual(parseHash('#library'), { view: 'library', sub: 'all' });
  assert.deepEqual(parseHash('#library/watching'), { view: 'library', sub: 'watching' });
  assert.deepEqual(parseHash('#explore/tv-animated'), { view: 'explore', sub: 'tv-animated' });
  assert.deepEqual(parseHash('#account'), { view: 'account', sub: 'all' });
  assert.deepEqual(parseHash('#nonsense/x'), { view: 'library', sub: 'x' });
  assert.deepEqual(parseHash('#explore/movie/extra'), { view: 'explore', sub: 'movie' });
});

test('search text survives the trip into the address and back', () => {
  const queries = [
    'inception',
    'the office',
    'a/b',
    'a//b/',
    'c#',
    '#hashtag',
    '100%',
    '50%25',
    'amélie',
    'ñandú & más',
    '日本語',
    'what?',
    'a=b&c=d',
    '"quoted"',
    "it's",
    '<b>bold</b>',
    '😀 emoji',
  ];
  for (const q of queries) {
    const hash = searchHash(q);
    assert.deepEqual(parseHash(hash), { view: 'search', sub: q }, q);
    assert.equal(hash.slice(1).split('/').length, 2, `no extra "/" in ${hash}`);
    assert.ok(!hash.slice(1).includes('#'), `no extra "#" in ${hash}`);
  }
});

test('spaces around the search text are dropped', () => {
  assert.equal(searchHash('  the office '), '#search/the%20office');
  assert.deepEqual(parseHash('#search/%20%20the%20office%20'), { view: 'search', sub: 'the office' });
});

test('a search typed into the address by hand still works', () => {
  assert.deepEqual(parseHash('#search/the office'), { view: 'search', sub: 'the office' });
  assert.deepEqual(parseHash('#search/a/b'), { view: 'search', sub: 'a/b' });
});

test('broken % sequences are used as typed, not an error', () => {
  assert.deepEqual(parseHash('#search/100%'), { view: 'search', sub: '100%' });
  assert.deepEqual(parseHash('#search/%E0%A4%A'), { view: 'search', sub: '%E0%A4%A' });
  assert.deepEqual(parseHash('#search/%zz'), { view: 'search', sub: '%zz' });
  assert.equal(decodeQuery('%'), '%');
  assert.equal(decodeQuery('%41'), 'A');
});

test('a search with no text opens the Library', () => {
  for (const hash of ['#search', '#search/', '#search/%20', '#search/%20%20']) {
    assert.deepEqual(parseHash(hash), { view: 'library', sub: 'all' }, hash);
  }
});
