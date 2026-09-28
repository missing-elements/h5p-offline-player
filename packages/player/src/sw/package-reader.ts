import { ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js'
import { INLINE_MAX_SIZE, MEDIA_INLINE_MAX_SIZE, WARM_ENTRY_MAX_SIZE, WARM_GAP, WARM_MAX_BYTES } from '../shared/constants'
import { indexEntryNames, normalizeEntryName } from '../shared/entry-names'
import { isMediaEntry, isTextEntry } from '../shared/mime'
import { DEFLATE, LOCAL_HEADER_FIXED_SIZE, STORED, localHeaderDataStart } from '../shared/local-header'
import {
  PlayerError,
  type EntryLocation,
  type MissingLibraries,
  type PrefetchEntry,
  type WarmEntry,
  type WarmSpan
} from '../shared/protocol'
import type { SourceHandle } from '../shared/source'
import { SourceReader } from '../shared/source-reader'
import type { ByteRange } from '../shared/range'
import type { ForwardEntry, ForwardIndexSnapshot } from '../shared/forward-index'

/**
 * The package reader: a zip central directory turned into a name → entry index, plus the decision
 * of how each entry gets served. It does not walk dependencies — h5p-standalone resolves
 * `preloadedDependencies` itself and asks for the files it needs by name.
 */

export type Strategy =
  /** Small, or text the runtime has to parse whole: inflate once into the cache, then serve. */
  | { kind: 'inline' }
  /** Large and stored (method 0): the bytes are already flat in the archive, so slice them. */
  | { kind: 'slice' }
  /** Large and deflated (method 8): the Jobs worker inflates into chunks, served progressively. */
  | { kind: 'chunked' }

export { DEFLATE, STORED }

/** The parts of `h5p.json` the player needs. Everything in it comes from an untrusted archive. */
export interface PackageManifest {
  title?: string
  mainLibrary?: string
  preloadedDependencies?: LibraryDependency[]
}

export interface LibraryDependency {
  machineName: string
  majorVersion: string | number
  minorVersion: string | number
}

export interface IndexedEntry {
  /** Normalised name, the form the virtual server routes on. */
  name: string
  size: number
  compressedSize: number
  method: number
  strategy: Strategy
  /** The zip.js entry, for an index read from the central directory. Absent for a forward entry. */
  zip?: FileEntry
  /** Where the compressed bytes begin, when the local header has already been read. */
  dataStart?: number
  encrypted?: boolean
}

/**
 * An entry together with the archive it lives in. A package may be served from more than one:
 * content from the one the user opened, libraries from a bundle attached to fill its gaps.
 */
export interface LocatedEntry {
  reader: PackageReader
  entry: IndexedEntry
}

export class PackageReader {
  readonly pkgId: string
  readonly entries: Map<string, IndexedEntry>
  readonly rejected: string[]
  manifest: PackageManifest
  /**
   * Built from the forward index of an archive still downloading. Entries arrive as the download
   * does — `absorb()` takes them in — and every answer is provisional until the archive is whole
   * and a reader from its central directory replaces this one.
   */
  readonly partial: boolean
  /** For a partial reader: how far the archive is accounted for, and whether its index is complete. */
  parsedTo = 0
  forwardDone = false
  private forwardStopped = false
  private absorbed = 0
  /** Top-level folder of the newest entry: the one folder that may still be receiving files. */
  private lastTopFolder: string | null = null

  /** Archives consulted, in order, for an entry this one does not have. */
  private readonly fallbacks: PackageReader[] = []
  /** Library folders reachable from here, built on first use and dropped when `use()` adds more. */
  private librariesByName: Map<string, LibraryFolder[]> | null = null
  /** Data offsets of stored entries, each read from its local header once. */
  private readonly dataRanges = new Map<string, Promise<ByteRange>>()

  private constructor(
    pkgId: string,
    /** The archive this reader reads. Exposed for the Jobs worker's liveness reports. */
    readonly handle: SourceHandle,
    entries: Map<string, IndexedEntry>,
    rejected: string[],
    manifest: PackageManifest,
    partial = false
  ) {
    this.pkgId = pkgId
    this.entries = entries
    this.rejected = rejected
    this.manifest = manifest
    this.partial = partial
  }

  get title(): string | undefined {
    return this.manifest.title
  }

  static async open(
    pkgId: string,
    handle: SourceHandle,
    options: { requireLibraries?: boolean } = {}
  ): Promise<PackageReader> {
    let zipEntries: Entry[]
    try {
      const zip = new ZipReader(new SourceReader(handle))
      // zip.js would otherwise refuse the whole archive over one unsafe name. Names are validated
      // here instead, per entry, so a package that happens to carry one hostile path still plays
      // with that path dropped — and nothing downstream ever sees an unnormalised name.
      zipEntries = await zip.getEntries({ filenameValidation: 'tolerant' })
    } catch (error) {
      throw new PlayerError('bad-archive', 'Could not read the archive index', { cause: error })
    }

    const { index, rejected } = indexEntryNames(zipEntries)
    const entries = new Map<string, IndexedEntry>()

    for (const [name, zip] of index) {
      entries.set(name, {
        name,
        size: zip.uncompressedSize,
        compressedSize: zip.compressedSize,
        method: zip.compressionMethod,
        strategy: chooseStrategy(name, zip),
        // `indexEntryNames` drops directory entries, so every survivor has readable data.
        zip: zip as FileEntry
      })
    }

    if (!entries.has('h5p.json')) {
      throw new PlayerError('bad-archive', 'Archive has no h5p.json, so it is not an H5P package')
    }

    const bare = new PackageReader(pkgId, handle, entries, rejected, {})
    const manifest = await readManifest(bare)

    const reader = new PackageReader(pkgId, handle, entries, rejected, manifest)
    // A package that will have a library bundle attached is validated after the attach, not here.
    if (options.requireLibraries !== false) reader.assertLibrariesPresent()

    return reader
  }

  /**
   * A reader over an archive that is still downloading, from the entries its local headers have
   * given up so far. Nothing is asserted here: what is missing may simply not have arrived.
   */
  static async fromForwardIndex(
    pkgId: string,
    handle: SourceHandle,
    snapshot: ForwardIndexSnapshot
  ): Promise<PackageReader> {
    const reader = new PackageReader(pkgId, handle, new Map(), [], {}, true)
    await reader.absorb(snapshot)
    return reader
  }

  /**
   * Takes in the entries a newer snapshot has and this reader does not. Snapshots are cumulative
   * and in archive order, so only the tail is new; the same first-occurrence rule as the full
   * index applies, so a later duplicate can never shadow an entry already served.
   */
  async absorb(snapshot: ForwardIndexSnapshot): Promise<boolean> {
    if (!this.partial) return false
    const fresh = snapshot.entries.slice(this.absorbed)
    this.absorbed = snapshot.entries.length
    this.parsedTo = snapshot.parsedTo
    this.forwardDone = snapshot.done
    this.forwardStopped = snapshot.stopped !== null && !snapshot.done

    let manifestArrived = false
    for (const forward of fresh) {
      if (forward.directory) continue
      const name = normalizeEntryName(forward.name)
      if (name === null || this.entries.has(name)) {
        this.rejected.push(forward.name)
        continue
      }
      this.entries.set(name, entryFromForward(name, forward))
      this.lastTopFolder = topFolderOf(name)
      if (name === 'h5p.json') manifestArrived = true
    }

    if (fresh.length > 0) this.librariesByName = null
    if (manifestArrived) this.manifest = await readManifest(this)
    return fresh.length > 0
  }

  /**
   * For a partial reader: whether the runtime could boot from what has arrived — `h5p.json`, and
   * for every dependency it declares a folder that is present and finished arriving. A folder has
   * finished once an entry of a later folder has been seen, since exporters write a folder's files
   * together; only the newest folder may still be growing. An index the scanner had to give up on
   * never says ready: what it could not see must wait for the central directory.
   */
  bootReady(): boolean {
    if (!this.partial) return true
    if (this.forwardStopped || !this.entries.has('h5p.json')) return false

    const dependencies = this.manifest.preloadedDependencies
    if (!Array.isArray(dependencies) || dependencies.length === 0) return false

    const names = this.entryNames()
    const available = this.availableLibraries()
    return dependencies.every((dependency) => {
      const folder =
        libraryFolderNames(dependency).find((each) => names.has(`${each}/library.json`)) ??
        resolveLibraryFolder(available, {
          machineName: dependency.machineName,
          major: Number(dependency.majorVersion),
          minor: Number(dependency.minorVersion)
        })
      return folder !== undefined && this.folderComplete(folder)
    })
  }

  /**
   * For a partial reader: a miss that can be answered without waiting for more of the archive.
   * True when the entry's top-level folder has already finished arriving, or when the request
   * is h5p-standalone's versioned probe on a package that keeps that library unversioned.
   */
  provablyAbsent(name: string): boolean {
    if (!this.partial || this.forwardDone) return true
    const top = topFolderOf(name)
    if (top === null) return false

    if (this.hasFolder(top)) return this.folderComplete(top)

    const wanted = parseLibraryFolder(top)
    return wanted !== null && this.hasFolder(wanted.machineName) && this.folderComplete(wanted.machineName)
  }

  private folderComplete(folder: string): boolean {
    return this.forwardDone || this.lastTopFolder !== folder
  }

  private hasFolder(folder: string): boolean {
    const prefix = `${folder}/`
    for (const name of this.entries.keys()) if (name.startsWith(prefix)) return true
    return false
  }

  /** Adds an archive to consult for entries this one does not carry. */
  use(reader: PackageReader): void {
    if (reader === this || this.fallbacks.includes(reader)) return
    this.fallbacks.push(reader)
    this.librariesByName = null
  }

  /**
   * Looks an entry up in this archive, then in each attached one.
   *
   * A miss on a library path is retried against a compatible version of the same library, so
   * content asking for `H5P.Text-1.0/...` is served from `H5P.Text-1.1/...` when that is what
   * the attached bundle happens to ship.
   */
  get(name: string): LocatedEntry | undefined {
    return this.locate(name) ?? this.locateCompatible(name)
  }

  /** Exact lookup, this archive first and then each attached one, in order. */
  private locate(name: string): LocatedEntry | undefined {
    const own = this.entries.get(name)
    if (own) return { reader: this, entry: own }

    for (const fallback of this.fallbacks) {
      const found = fallback.locate(name)
      if (found) return found
    }
    return undefined
  }

  private locateCompatible(name: string): LocatedEntry | undefined {
    const slash = name.indexOf('/')
    if (slash < 0) return undefined

    // Library folders are always the first path segment, so nothing deeper is ever reinterpreted.
    const wanted = parseLibraryFolder(name.slice(0, slash))
    if (!wanted) return undefined

    const folder = resolveLibraryFolder(this.availableLibraries(), wanted)
    if (!folder || folder === wanted.folder) return undefined

    return this.locate(`${folder}/${name.slice(slash + 1)}`)
  }

  /**
   * Library folders reachable from here, this archive's own taking precedence.
   *
   * Memoised, because this runs on the miss path and misses are not rare: h5p-standalone probes
   * `<Library>-<major>.<minor>/library.json` on purpose to learn whether a package uses versioned
   * folders, so every load walks through here several times. Rebuilding a map over every entry
   * name — two thousand of them in a real package — on each of those is work that never changes
   * its answer. The entry set is fixed after `open`; only `use()` can change the result, and it
   * drops the cache.
   */
  private availableLibraries(): Map<string, LibraryFolder[]> {
    if (this.librariesByName) return this.librariesByName

    const merged = indexLibraryFolders(this.entries.keys())
    for (const fallback of this.fallbacks) {
      for (const [machineName, folders] of fallback.availableLibraries()) {
        const existing = merged.get(machineName)
        if (existing) existing.push(...folders)
        else merged.set(machineName, [...folders])
      }
    }

    this.librariesByName = merged
    return merged
  }

  /** Every entry name reachable through this reader, including the attached archives. */
  entryNames(): Set<string> {
    const names = new Set(this.entries.keys())
    for (const fallback of this.fallbacks) {
      for (const name of fallback.entryNames()) names.add(name)
    }
    return names
  }

  /** What `h5p.json` declares but nothing reachable from here provides. */
  missingLibraries(): MissingLibraries | null {
    return describeMissingLibraries(this.entryNames(), this.manifest)
  }

  /** True when another archive is supplying entries this one does not have. */
  get hasFallbacks(): boolean {
    return this.fallbacks.length > 0
  }

  /**
   * The manifest as the runtime should see it once a library bundle is attached.
   *
   * A content-only export does not just drop the library folders, it also strips
   * `preloadedDependencies` down to the main library — so the runtime would load Interactive
   * Video and none of the interaction types used inside it, and the first interaction would fail
   * with "Unable to find constructor". The bundle's own manifest is the list the content type
   * was published with, so the two are merged: a dependency is kept only if its folder is
   * actually reachable, and the content's own version wins when both archives have one.
   */
  mergedManifest(): PackageManifest {
    const names = this.entryNames()
    const kept = new Map<string, LibraryDependency>()

    const consider = (dependency: LibraryDependency) => {
      if (kept.has(dependency.machineName)) return
      if (!libraryFolderNames(dependency).some((folder) => names.has(`${folder}/library.json`))) return
      kept.set(dependency.machineName, dependency)
    }

    for (const dependency of this.manifest.preloadedDependencies ?? []) consider(dependency)
    for (const fallback of this.fallbacks) {
      for (const dependency of fallback.manifest.preloadedDependencies ?? []) consider(dependency)
    }

    return { ...this.manifest, preloadedDependencies: [...kept.values()] }
  }

  assertLibrariesPresent(): void {
    const missing = this.missingLibraries()
    if (!missing) return

    throw new PlayerError('bad-archive', explainMissingLibraries(missing), {
      missingLibraries: missing
    })
  }

  /**
   * Entries that cannot be served cold without a background inflate, in archive order.
   *
   * Everything else is reachable on demand: a stored entry is already flat in the archive and
   * gets sliced, and a small one is cheap to inflate when asked for. Only a large deflated entry
   * makes the runtime wait on a job, so only these are worth starting early.
   *
   * Archive order, not largest first: the point is to have an entry before the learner reaches
   * it, and the order the packager wrote them in tracks the order the content uses them far
   * better than size does. The biggest video is not usually the first one on screen.
   */
  prefetchable(): PrefetchEntry[] {
    return [...this.entries.values()]
      .filter((entry) => entry.strategy.kind === 'chunked')
      .map((entry) => ({ entry: entry.name, size: entry.size, location: locationOf(entry) }))
  }

  /**
   * The runs of the archive worth pulling whole before the frame boots, in archive order.
   *
   * The runtime reads the libraries exhaustively at boot — every `library.json`, script and
   * stylesheet — and each inline entry costs one or two ranged requests when read on demand. On a
   * host with half a second of latency that is a minute of round trips for a megabyte of files,
   * and on one that answers a client's requests one at a time it is two. The archive's layout is
   * the way out: exporters write a library's files together and the libraries together, so the
   * entries the boot needs lie in a few contiguous runs, and one request per run lands them all.
   *
   * A candidate is a small inline entry that is not media; its bytes end where the next local
   * header begins, since a zip is contiguous. Candidates closer than `WARM_GAP` share a span, so
   * a large video between two library folders splits the run and is never pulled. A span with
   * nothing the boot reads — a cluster of images and no script, style or JSON — is left to
   * demand, and the total is capped at `WARM_MAX_BYTES`, taking spans in archive order.
   *
   * Only for an index read from the central directory: a forward entry has no offset to walk
   * from, and the archive it came from is local anyway.
   */
  warmSpans(): WarmSpan[] {
    const located = [...this.entries.values()].filter((entry) => entry.zip !== undefined)
    const offsets = located.map((entry) => entry.zip!.offset).sort((a, b) => a - b)
    const nextOffset = new Map<number, number>()
    for (let i = 0; i + 1 < offsets.length; i += 1) nextOffset.set(offsets[i], offsets[i + 1])

    const candidates = located
      .filter(
        (entry) =>
          entry.strategy.kind === 'inline' &&
          !entry.zip!.encrypted &&
          (entry.method === STORED || entry.method === DEFLATE) &&
          entry.compressedSize <= WARM_ENTRY_MAX_SIZE &&
          !isMediaEntry(entry.name)
      )
      .sort((a, b) => a.zip!.offset - b.zip!.offset)

    const spans: WarmSpan[] = []
    for (const entry of candidates) {
      const zip = entry.zip!
      // The central directory's name and extra lengths are the local header's in practice; the
      // slack covers a local extra field that is longer, for the last entry of the archive,
      // which has no successor to bound it.
      const computed =
        zip.offset + LOCAL_HEADER_FIXED_SIZE + zip.rawFilename.length + zip.rawExtraField.length + entry.compressedSize
      const end = nextOffset.get(zip.offset) ?? Math.min(this.handle.size, computed + 4096)
      const record: WarmEntry = {
        name: entry.name,
        offset: zip.offset,
        compressedSize: entry.compressedSize,
        size: entry.size,
        method: entry.method
      }
      const last = spans[spans.length - 1]
      if (last && zip.offset - last.end <= WARM_GAP) {
        last.end = Math.max(last.end, end)
        last.entries.push(record)
      } else {
        spans.push({ start: zip.offset, end, entries: [record] })
      }
    }

    const kept: WarmSpan[] = []
    let budget = WARM_MAX_BYTES
    for (const span of spans) {
      if (!span.entries.some((entry) => isTextEntry(entry.name))) continue
      const length = span.end - span.start
      if (length > budget) continue
      budget -= length
      kept.push(span)
    }
    return kept
  }

  /**
   * Inflates an entry into a stream. The stream is handed straight to `cache.put()` or to a
   * `Response`, so the entry never sits in memory as a whole.
   *
   * An entry from the central directory goes through zip.js. A forward entry has no zip.js object
   * behind it and is inflated directly: its compressed span is known from its local header, and
   * `DecompressionStream` does the rest — the same codec zip.js would have used.
   */
  inflate(entry: IndexedEntry): ReadableStream<Uint8Array> {
    if (!entry.zip) return this.inflateDirect(entry)

    if (entry.zip.encrypted) {
      throw new PlayerError('bad-archive', `${entry.name} is encrypted`)
    }
    const getData = entry.zip.getData
    if (!getData) {
      throw new PlayerError('bad-archive', `${entry.name} has no readable data`)
    }

    const transform = new TransformStream<Uint8Array, Uint8Array>()
    // Not awaited: the consumer reads the readable side while zip.js writes the writable side.
    // zip.js pipes into that writable and aborts it itself when the inflate fails, which errors
    // the readable the consumer holds — this abort is only the fallback for a rejection that
    // never reached the stream, and it is refused while zip.js still holds the writer.
    void getData.call(entry.zip, transform.writable).catch((error: unknown) => {
      // A locked writable means zip.js still holds the writer and has already errored the stream
      // on its way out; aborting it again is refused, in Chromium by throwing.
      if (transform.writable.locked) return
      try {
        void transform.writable.abort(error)
      } catch {
        // Already aborted or closed: the consumer has its error either way.
      }
    })

    return transform.readable
  }

  /**
   * Byte range of an entry's compressed data inside the archive. The central directory records
   * where the *local* header starts, and the local header's own name and extra fields are what
   * stand between it and the bytes, so the header has to be read to find them — unless a forward
   * entry already knows, having come from that very header.
   *
   * Read once per entry and kept as a promise: a media element opens with a burst of range
   * requests, and every one of them used to pay a round trip for the same thirty bytes — over
   * HTTP, a second request on top of the one for the data — and every seek after that paid it
   * again. Now the burst shares one read and a seek pays none.
   */
  dataRange(entry: IndexedEntry): Promise<ByteRange> {
    const known = this.dataRanges.get(entry.name)
    if (known) return known

    const reading = this.readDataRange(entry)
    this.dataRanges.set(entry.name, reading)
    reading.catch(() => this.dataRanges.delete(entry.name))
    return reading
  }

  private inflateDirect(entry: IndexedEntry): ReadableStream<Uint8Array> {
    if (entry.encrypted) throw new PlayerError('bad-archive', `${entry.name} is encrypted`)
    if (entry.method !== STORED && entry.method !== DEFLATE) {
      throw new PlayerError('bad-archive', `${entry.name} uses compression method ${entry.method}`)
    }
    if (entry.compressedSize === 0) return new Blob([]).stream()

    const raw = deferredStream(() => this.sliceStream(entry, { start: 0, end: entry.compressedSize - 1 }))
    if (entry.method === STORED) return raw
    // The lib types the codec's input as `BufferSource`, stricter than the plain views it gets.
    const inflate = new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
    return raw.pipeThrough(inflate)
  }

  private async readDataRange(entry: IndexedEntry): Promise<ByteRange> {
    if (entry.dataStart !== undefined) {
      return { start: entry.dataStart, end: entry.dataStart + entry.compressedSize - 1 }
    }
    if (!entry.zip) throw new PlayerError('bad-archive', `${entry.name} has no known location`)

    const header = await this.handle.read({
      start: entry.zip.offset,
      end: entry.zip.offset + LOCAL_HEADER_FIXED_SIZE - 1
    })

    const start = localHeaderDataStart(entry.zip.offset, header)
    if (start === null) throw new PlayerError('bad-archive', `${entry.name} has a malformed local header`)

    return { start, end: start + entry.compressedSize - 1 }
  }

  /** Streams a range of an entry's compressed bytes straight out of the source. No storage. */
  async sliceStream(entry: IndexedEntry, range: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const data = await this.dataRange(entry)
    return this.handle.stream({
      start: data.start + range.start,
      end: data.start + range.end
    })
  }
}

/**
 * Where an entry's compressed bytes are, for a job that extracts it without an index of its own.
 * A central-directory entry is named by its local header; a forward entry by where its data
 * begins, since the scanner has already read the header.
 */
export function locationOf(entry: IndexedEntry): EntryLocation {
  return {
    header: entry.zip?.offset,
    dataStart: entry.dataStart,
    compressedSize: entry.compressedSize,
    size: entry.size,
    method: entry.method
  }
}

/**
 * Serving strategy for one entry. Size decides first, then compression method: only a large
 * deflated entry is worth the cost of a background extraction. Media has its own, lower bar —
 * see `MEDIA_INLINE_MAX_SIZE` — because a media element only ever wants the head first.
 */
export function chooseStrategy(
  name: string,
  entry: { uncompressedSize: number; compressionMethod: number }
): Strategy {
  if (isTextEntry(name)) return { kind: 'inline' }
  const limit = isMediaEntry(name) ? MEDIA_INLINE_MAX_SIZE : INLINE_MAX_SIZE
  if (entry.uncompressedSize <= limit) return { kind: 'inline' }
  if (entry.compressionMethod === STORED) return { kind: 'slice' }
  if (entry.compressionMethod === DEFLATE) return { kind: 'chunked' }
  // Anything else (zstd, bzip2, an encrypted entry) still works through zip.js if a codec is
  // registered, so it takes the inline path rather than being refused outright.
  return { kind: 'inline' }
}

/* ------------------------------------------------------------------ manifest and libraries */

function entryFromForward(name: string, forward: ForwardEntry): IndexedEntry {
  return {
    name,
    size: forward.uncompressedSize,
    compressedSize: forward.compressedSize,
    method: forward.method,
    strategy: chooseStrategy(name, {
      uncompressedSize: forward.uncompressedSize,
      compressionMethod: forward.method
    }),
    dataStart: forward.dataStart,
    encrypted: forward.encrypted
  }
}

function topFolderOf(name: string): string | null {
  const slash = name.indexOf('/')
  return slash < 0 ? null : name.slice(0, slash)
}

/** A stream that opens its source on the first pull, so building it costs nothing until it is read. */
function deferredStream(open: () => Promise<ReadableStream<Uint8Array>>): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reader ??= (await open()).getReader()
        const { done, value } = await reader.read()
        if (done) controller.close()
        else controller.enqueue(value)
      },
      async cancel(reason) {
        await reader?.cancel(reason)
      }
    },
    { highWaterMark: 0 }
  )
}

async function readManifest(reader: PackageReader): Promise<PackageManifest> {
  const { entry } = reader.get('h5p.json')!

  try {
    const parsed = (await new Response(reader.inflate(entry)).json()) as PackageManifest
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    return parsed
  } catch (error) {
    throw new PlayerError('bad-archive', 'h5p.json is not readable JSON', { cause: error })
  }
}

/**
 * The two folder names a library may be stored under. h5p-standalone probes the versioned one
 * first and falls back to the bare machine name, so a package is usable with either.
 */
function libraryFolderNames(dependency: LibraryDependency): string[] {
  return [
    `${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}`,
    dependency.machineName
  ]
}

export interface LibraryFolder {
  machineName: string
  major: number
  minor: number
  folder: string
}

/** Splits `H5P.Text-1.1` into its parts, or returns `null` for a folder that is not a library. */
export function parseLibraryFolder(folder: string): LibraryFolder | null {
  const match = /^(.+)-(\d+)\.(\d+)$/.exec(folder)
  if (!match) return null
  return {
    machineName: match[1],
    major: Number(match[2]),
    minor: Number(match[3]),
    folder
  }
}

/** Every library folder in a set of entry names, grouped by machine name. */
export function indexLibraryFolders(entryNames: Iterable<string>): Map<string, LibraryFolder[]> {
  const byName = new Map<string, LibraryFolder[]>()

  for (const name of entryNames) {
    const slash = name.indexOf('/')
    if (slash < 0 || name.slice(slash + 1) !== 'library.json') continue

    const parsed = parseLibraryFolder(name.slice(0, slash))
    if (!parsed) continue

    const existing = byName.get(parsed.machineName)
    if (existing) existing.push(parsed)
    else byName.set(parsed.machineName, [parsed])
  }

  return byName
}

/**
 * Picks the folder that satisfies a dependency, by H5P's own compatibility rule: the same major
 * version, and a minor at least as high as the one asked for. Libraries are backward compatible
 * within a major, which is why a platform installs one version per major and content authored
 * against an older minor keeps working.
 *
 * This matters whenever libraries come from somewhere other than the package: a hub bundle ships
 * the current `H5P.Text-1.1` while content authored earlier asks for `H5P.Text-1.0`, and without
 * this every such request is a 404.
 *
 * The lowest satisfying version wins, as the closest to what the content was written against.
 */
export function resolveLibraryFolder(
  available: Map<string, LibraryFolder[]>,
  dependency: { machineName: string; major: number; minor: number }
): string | undefined {
  const satisfying = (available.get(dependency.machineName) ?? [])
    .filter((candidate) => candidate.major === dependency.major && candidate.minor >= dependency.minor)
    .sort((a, b) => a.minor - b.minor)

  return satisfying[0]?.folder
}

/**
 * The dependencies `h5p.json` declares that the archive does not actually carry. Pure, so the
 * rule can be checked without building a zip.
 */
export function findMissingLibraries(
  entryNames: ReadonlySet<string>,
  manifest: PackageManifest
): LibraryDependency[] {
  const dependencies = manifest.preloadedDependencies
  if (!Array.isArray(dependencies)) return []

  const available = indexLibraryFolders(entryNames)

  return dependencies.filter((dependency) => {
    // The name as written, or the bare machine name h5p-standalone falls back to.
    if (libraryFolderNames(dependency).some((folder) => entryNames.has(`${folder}/library.json`))) {
      return false
    }

    // Otherwise anything compatible will serve, the same way the reader resolves it.
    return !resolveLibraryFolder(available, {
      machineName: dependency.machineName,
      major: Number(dependency.majorVersion),
      minor: Number(dependency.minorVersion)
    })
  })
}

/**
 * What a package declares but does not carry, or `null` when it carries everything.
 *
 * Exports from h5p.com and h5p.org routinely leave the libraries out: the platform they came from
 * already has them, so bundling them would be waste. Played anywhere else, such an archive is
 * just a `content/` folder — the runtime asks for `<MainLibrary>/library.json`, gets a 404, and
 * fails with nothing to go on.
 */
export function describeMissingLibraries(
  entryNames: ReadonlySet<string>,
  manifest: PackageManifest
): MissingLibraries | null {
  const dependencies = manifest.preloadedDependencies

  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    return { mainLibrary: manifest.mainLibrary, folders: [], all: true }
  }

  const missing = findMissingLibraries(entryNames, manifest)
  if (missing.length === 0) return null

  return {
    mainLibrary: manifest.mainLibrary,
    folders: missing.map((dependency) => libraryFolderNames(dependency)[0]),
    all: missing.length === dependencies.length
  }
}

export function explainMissingLibraries(missing: MissingLibraries): string {
  if (missing.folders.length === 0) {
    return 'h5p.json lists no preloadedDependencies, so there is nothing to run'
  }

  const names = missing.folders.join(', ')

  return missing.all
    ? `This package contains no libraries, only content. Exports from h5p.com and h5p.org ` +
        `often leave them out because the site they came from already has them. ` +
        `Set the "libraries" attribute to fetch them, or re-export with them included. ` +
        `Missing: ${names}`
    : `This package is missing ${missing.folders.length} of its libraries: ${names}. ` +
        `Set the "libraries" attribute to fetch them, or re-export with them included.`
}
