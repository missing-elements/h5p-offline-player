import { DB_NAME, DB_VERSION, PACKAGES_STORE } from './constants'
import type { PackageRecord } from './protocol'

/**
 * The `packages` table. Both the page and the Service Worker open it: the page writes the
 * descriptor before asking the worker to index, and the worker reads it to rebuild adapters
 * after a restart. Indexed on `lastPlayed` so eviction can find the coldest package without
 * loading every row.
 */

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Drops the cached handle, so the next call opens a fresh one.
 *
 * Only if it is still the current handle: a connection that closed long ago must not discard the
 * replacement someone has since opened.
 */
function forget(db: IDBDatabase, opened: Promise<IDBDatabase>): void {
  if (dbPromise === opened) dbPromise = null
  db.close()
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  const opened: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PACKAGES_STORE)) {
        const store = db.createObjectStore(PACKAGES_STORE, { keyPath: 'pkgId' })
        store.createIndex('lastPlayed', 'lastPlayed')
      }
    }

    request.onsuccess = () => {
      const db = request.result

      // This handle is long-lived — the Service Worker holds it across every request it serves —
      // so it has to survive the database going away underneath it. Clearing site data closes it
      // from outside, and a `deleteDatabase` elsewhere blocks until it is closed from here.
      // Without both of these, every later call throws "the database connection is closing"
      // and nothing recovers short of a reload.
      db.onversionchange = () => forget(db, opened)
      db.onclose = () => forget(db, opened)

      resolve(db)
    }

    request.onerror = () => reject(request.error)
  })

  dbPromise = opened

  // A failed open must not be cached: the next call should try again.
  opened.catch(() => {
    if (dbPromise === opened) dbPromise = null
  })

  return opened
}

/** True for the errors a handle raises once the database beneath it is gone. */
function isConnectionGone(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'InvalidStateError' ||
      error.name === 'NotFoundError' ||
      error.name === 'TransactionInactiveError')
  )
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const db = await openDatabase()
  const transaction = db.transaction(PACKAGES_STORE, mode)
  const result = await run(transaction.objectStore(PACKAGES_STORE))

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })

  return result
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  try {
    return await runTransaction(mode, run)
  } catch (error) {
    if (!isConnectionGone(error)) throw error

    // The handle died between being handed out and being used — site data cleared mid-request is
    // the ordinary way that happens. Reopening recreates the store, so the retry starts from an
    // empty table rather than failing for the rest of the worker's life.
    dbPromise = null
    return runTransaction(mode, run)
  }
}

export function getPackage(pkgId: string): Promise<PackageRecord | undefined> {
  return withStore('readonly', (store) => promisify(store.get(pkgId) as IDBRequest<PackageRecord | undefined>))
}

export function putPackage(record: PackageRecord): Promise<void> {
  return withStore('readwrite', async (store) => {
    await promisify(store.put(record))
  })
}

export function deletePackage(pkgId: string): Promise<void> {
  return withStore('readwrite', async (store) => {
    await promisify(store.delete(pkgId))
  })
}

export function allPackages(): Promise<PackageRecord[]> {
  return withStore('readonly', (store) => promisify(store.getAll() as IDBRequest<PackageRecord[]>))
}

export async function touchPackage(pkgId: string): Promise<void> {
  const record = await getPackage(pkgId)
  if (!record) return
  record.lastPlayed = Date.now()
  await putPackage(record)
}

export async function updatePackage(
  pkgId: string,
  patch: Partial<PackageRecord>
): Promise<PackageRecord | undefined> {
  const record = await getPackage(pkgId)
  if (!record) return undefined
  const next = { ...record, ...patch }
  await putPackage(next)
  return next
}

/** Packages ordered coldest first. Eviction walks this list. */
export async function packagesByAge(): Promise<PackageRecord[]> {
  const records = await allPackages()
  return records.sort((a, b) => a.lastPlayed - b.lastPlayed)
}
