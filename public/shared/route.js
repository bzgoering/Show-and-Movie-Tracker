// Reading and writing the page address (the part after #), e.g. "#explore/tv-animated" or "#search/the%20office".
// Kept free of browser code so it can be tested; js/lib/router.js and the script in index.html use the same format.

export const TAB_PAGES = ['library', 'explore', 'account']; // the pages in the top bar
export const SEARCH_PAGE = 'search'; // reached only by searching, never from the top bar

// Undoes encodeURIComponent, but never throws: text with a stray "%" (e.g. "100%") is used as typed.
export function decodeQuery(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// "#library/watching" -> { view: 'library', sub: 'watching' }. Unknown pages open the Library.
// For the search page, sub is the search text (decoded), not a tab: "#search/a%2Fb" -> { view: 'search', sub: 'a/b' }.
// A search with no text has nothing to show, so it opens the Library.
export function parseHash(hash) {
  const text = hash.replace(/^#/, '');
  const slash = text.indexOf('/');
  const view = slash === -1 ? text : text.slice(0, slash);
  const rest = slash === -1 ? '' : text.slice(slash + 1);
  if (view === SEARCH_PAGE) {
    const query = decodeQuery(rest).trim();
    return query ? { view, sub: query } : { view: 'library', sub: 'all' };
  }
  return { view: TAB_PAGES.includes(view) ? view : 'library', sub: rest.split('/')[0] || 'all' };
}

// The address for a search. encodeURIComponent also covers "/", "#", "%", spaces and accents.
export const searchHash = (query) => `#${SEARCH_PAGE}/${encodeURIComponent(query.trim())}`;
