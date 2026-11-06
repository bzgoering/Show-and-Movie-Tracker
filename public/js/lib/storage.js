// Browser storage that never throws: in a private window, or with site data blocked, reads give the
// fallback and writes are skipped, so the page still works (choices just aren't remembered).

export function readStored(storage, key, fallback) {
  try {
    return storage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unavailable: nothing to do.
  }
}
