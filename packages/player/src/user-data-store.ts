import { USER_DATA_DB_NAME, USER_DATA_STORE } from './shared/constants'

/**
 * The learner's saved state on this device, one row per value the runtime saved: what H5P core
 * posts to its `contentUserData` endpoint on a site, kept here in the page's own IndexedDB.
 *
 * Keyed by the package and stamped with the build it was saved against — the same `revision`
 * every xAPI statement carries — so a state saved against one version of a package is never
 * handed to another; the element turns a mismatch into the runtime's own "content has changed,
 * starting over" dialog. The revision is `null` when the state was saved before the index had
 * said what the build was, which happens on a host that ignores `Range`, where the frame boots
 * from the forward index; `adoptRevision` fills it in once the index answers.
 *
 * Opened per call and closed after it. The page is the only client, a save is one small write
 * every few seconds at most, and a handle that is never held cannot be left dangling by a
 * "clear site data" underneath it. Never touched by eviction: it lives in a database of its own
 * that the Service Worker does not open, and it is small and not reproducible.
 */
export interface UserDataRow {
  /** `<pkgId>/<dataType>/<subContentId>`. */
  key: string
  pkgId: string
  dataType: string
  subContentId: string
  revision: string | null
  /** The value as the runtime produced it: a JSON string. */
  data: string
  updatedAt: number
}

export function userDataKey(pkgId: string, dataType: string, subContentId: string): string {
  return `${pkgId}/${dataType}/${subContentId}`
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(USER_DATA_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(USER_DATA_STORE, { keyPath: 'key' })
      store.createIndex('pkgId', 'pkgId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('The user-data database is blocked by another connection'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(USER_DATA_STORE, mode)
    const result = await run(transaction.objectStore(USER_DATA_STORE))
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    return result
  } finally {
    db.close()
  }
}

/** Every value saved for a package. */
export function readUserData(pkgId: string): Promise<UserDataRow[]> {
  return withStore('readonly', (store) =>
    promisify(store.index('pkgId').getAll(pkgId) as IDBRequest<UserDataRow[]>)
  )
}

export function writeUserData(row: Omit<UserDataRow, 'key'>): Promise<void> {
  return withStore('readwrite', async (store) => {
    await promisify(store.put({ ...row, key: userDataKey(row.pkgId, row.dataType, row.subContentId) }))
  })
}

export function removeUserData(pkgId: string, dataType: string, subContentId: string): Promise<void> {
  return withStore('readwrite', async (store) => {
    await promisify(store.delete(userDataKey(pkgId, dataType, subContentId)))
  })
}

/** Forgets everything saved for a package. */
export function clearUserData(pkgId: string): Promise<void> {
  return withStore('readwrite', async (store) => {
    const keys = await promisify(store.index('pkgId').getAllKeys(pkgId))
    for (const key of keys) await promisify(store.delete(key))
  })
}

/** Stamps the rows saved before the build was known with the revision the index then gave. */
export function adoptRevision(pkgId: string, revision: string): Promise<void> {
  return withStore('readwrite', async (store) => {
    const rows = await promisify(store.index('pkgId').getAll(pkgId) as IDBRequest<UserDataRow[]>)
    for (const row of rows) {
      if (row.revision === null) await promisify(store.put({ ...row, revision }))
    }
  })
}
