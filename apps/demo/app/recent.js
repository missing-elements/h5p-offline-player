/**
 * The files opened in the app, for the list on its home screen: each one's title, name and when it
 * was last opened, and what it takes to open it again. Installed from Chrome or Edge on the
 * desktop, the app gets a file handle — from their file picker, from a file dropped on it, and
 * from the file manager through the manifest's `file_handlers` — and IndexedDB keeps it, so the
 * file is read again from where it is on disk; why only installed is in `app.js`. Everywhere else
 * there is a `File` and nothing to find it by later, so the app keeps a copy of it instead, in a
 * store beside the list, and the list says how large it is. A link is kept as its address.
 *
 * All of it is in a database of the app's own, on this device, like the content's saved state, and
 * like that state any package played here can read it. Every call fails soft: the list is a
 * convenience, and a browser that keeps no IndexedDB, in a private window say, plays files without
 * it.
 */

const DB_NAME = 'h5p-app'
const DB_VERSION = 1
/** One record per file or link: see `remember`. */
const ENTRIES = 'recent'
/** The copies, by the same key, apart from the list so that reading the list reads no file. */
const COPIES = 'copies'
/** How many the list keeps; the oldest goes, with its copy, when one more is opened. */
export const RECENT_LIMIT = 20

/** A picked file's key: what the player knows a file by, so its saved place comes back with it. */
export const fileKey = (file) => `file:${file.name}:${file.size}:${file.lastModified}`
export const linkKey = (url) => `link:${url}`

let connection = null

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(COPIES)) db.createObjectStore(COPIES)
    }
    request.onsuccess = () => {
      const db = request.result
      // Clearing site data closes the connection under the page: open another next time.
      db.onclose = () => (connection = null)
      db.onversionchange = () => {
        db.close()
        connection = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  }).catch((error) => {
    connection = null
    throw error
  })
  return connection
}

const settled = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/**
 * Resolves once the transaction has committed, not when its request succeeded: a large copy that
 * does not fit fails as the transaction commits, after `put` has already reported success.
 */
const committed = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new DOMException('The write was abandoned', 'AbortError'))
  })

async function read(store, query) {
  const db = await database()
  return settled(query(db.transaction(store).objectStore(store)))
}

async function write(stores, change) {
  const db = await database()
  const transaction = db.transaction(stores, 'readwrite')
  change(transaction)
  await committed(transaction)
}

const newestFirst = (a, b) => b.openedAt - a.openedAt

/** The list, the file opened last first; empty where there is no database. */
export async function recentFiles() {
  try {
    return (await read(ENTRIES, (store) => store.getAll())).sort(newestFirst)
  } catch (error) {
    console.warn('[app] the list of recent files could not be read', error)
    return []
  }
}

/**
 * Records an open whose content came up. `entry` is `{ id, kind, name, title, size, lastModified,
 * url, handle }`; `file`, for a file with no handle, is kept as a copy unless one is kept already,
 * and the entry notes its size. A handle makes a copy kept before unnecessary, so it goes.
 */
export async function remember(entry, file) {
  try {
    let copySize = null
    if (entry.handle) await write(COPIES, (transaction) => transaction.objectStore(COPIES).delete(entry.id))
    else if (file) copySize = await keepCopy(entry.id, file)
    await write(ENTRIES, (transaction) => transaction.objectStore(ENTRIES).put({ ...entry, copySize, openedAt: Date.now() }))
    const entries = (await read(ENTRIES, (store) => store.getAll())).sort(newestFirst)
    for (const old of entries.slice(RECENT_LIMIT)) await forget(old.id)
  } catch (error) {
    console.warn('[app] the list of recent files was not updated', error)
  }
}

/** The size of the copy kept of `file`, or `null` when there was no room for it. */
async function keepCopy(id, file) {
  try {
    if (!(await read(COPIES, (store) => store.count(id)))) await write(COPIES, (transaction) => transaction.objectStore(COPIES).put(file, id))
    return file.size
  } catch (error) {
    console.warn(`[app] no copy of ${file.name} was kept`, error)
    return null
  }
}

/**
 * The copy kept of a file, under the name and date of the file it copies, which the player knows
 * a file by; `null` when none is kept, the browser has cleared it, or it cannot be read. A private
 * profile keeps a reference to the file on disk rather than its bytes — Chromium in the profile
 * Playwright opens did, where a profile on disk, Chromium's and Chrome's, kept the bytes
 * (2026-10-12) — so there a file moved or deleted since has no copy left, which a byte read finds
 * out before the player is handed it.
 */
export async function copyOf(entry) {
  try {
    const blob = await read(COPIES, (store) => store.get(entry.id))
    if (!blob) return null
    await blob.slice(0, 1).arrayBuffer()
    return new File([blob], entry.name, { lastModified: entry.lastModified, type: blob.type })
  } catch (error) {
    console.warn(`[app] the copy of ${entry.name} could not be read`, error)
    return null
  }
}

/** Takes one off the list, and its copy with it. */
export async function forget(id) {
  try {
    await write([ENTRIES, COPIES], (transaction) => {
      transaction.objectStore(ENTRIES).delete(id)
      transaction.objectStore(COPIES).delete(id)
    })
  } catch (error) {
    console.warn('[app] a recent file was not removed', error)
  }
}

/** Empties the list, and every copy with it. */
export async function forgetAll() {
  try {
    await write([ENTRIES, COPIES], (transaction) => {
      transaction.objectStore(ENTRIES).clear()
      transaction.objectStore(COPIES).clear()
    })
  } catch (error) {
    console.warn('[app] the list of recent files was not cleared', error)
  }
}
