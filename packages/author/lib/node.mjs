import { constants, createReadStream, createWriteStream, openAsBlob } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, rmdir, stat } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { tmpdir } from 'node:os'
import { BlockList, isIP } from 'node:net'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { BlobReader, ERR_UNSAFE_FILENAME, TextWriter, Uint8ArrayReader, ZipReader, ZipWriter } from '@zip.js/zip.js'
import { normalizeArchive } from '@missing-elements/h5p-normalize'
import { composePackage, sourceOf, typeNames, writePackage } from './build.mjs'
import { bundleLibraries, contentTypes } from './bundle.mjs'
import { MediaStore } from './media.mjs'
import { Pack } from './pack.mjs'
import { readContent } from './read.mjs'
import { SourceError } from './source-error.mjs'

/**
 * What only Node does of a build: the pack read from disk, a source's files read beside it and
 * downloads kept in a temporary folder, and the package written to a path, laid out to stream by
 * the normalizer, an mp4's index first. Everything else a build does is the page's build's too
 * (`browser.mjs`).
 */

/**
 * @typedef {import('./build.mjs').Problem} Problem
 * @typedef {import('./translate.mjs').TranslationReport} TranslationReport
 * @typedef {{
 *   output: string, manifest: Record<string, unknown>, content: Record<string, unknown>,
 *   libraries: string[], install: string[], coreApi: import('./install.mjs').CoreApi, translations: TranslationReport[], notes: Problem[], media: string[], outline: string
 * }} BuildResult what was written, and what is worth telling about it: `libraries`, the folders the
 *   package plays with; `install`, those carried for an H5P site's upload check; `coreApi`, the
 *   newest H5P core they ask for, which a site needs to take the package (`coreApiLine` says it);
 *   `outline`, the content as text for a review (`outlineOf`)
 * @typedef {{ libraries?: string, base?: string, fetch?: typeof fetch, within?: string[], check?: boolean }} BuildOptions
 *   `libraries`, a library pack's parts folder in place of the pinned pack; `base`, the folder a
 *   source's file paths are read from; `fetch`, for media named by web address; `within`, the
 *   folders the output and every local file a source names must be inside, on their real paths, a
 *   list even of one; `check`, to build and write no package: no output is needed or looked at, and
 *   the result's `output` is empty, but a media file named by web address is still downloaded, to a
 *   temporary folder removed after, as the build checks it; a video on YouTube, Vimeo, Panopto or
 *   Echo360 stays an address, as in a build
 * @typedef {{ output: string, source: import('./build.mjs').Source, files: string[], notes: Problem[] }} ReadResult
 *   `output`, the source's path; `files`, the media written beside it, by the paths the source
 *   names them by, from its folder; `notes`, what was left out or could not be read back as it is
 * @typedef {{ libraries?: string, within?: string[] }} ReadOptions
 *   `libraries`, a library pack's parts folder in place of the pinned pack; `within`, the folders
 *   the package and the folder written in must be inside, on their real paths, a list even of one
 * @typedef {{ output: string, type: string, parts: string[], size: number }} BundleResult
 *   `type`, the content type with the version bundled, `H5P.QuestionSet 1.21`; `parts`, the
 *   folders of the parts it holds; `size`, the zip's in bytes
 * @typedef {{ dev: bigint, ino: bigint }} Made a file this module created, by the device and
 *   inode it was given, which a file that takes its name later does not have
 */

/**
 * The parts folder a pack is read from: the one named, or the pinned pack's.
 * @param {string} [folder]
 */
function partsFolder(folder) {
  return folder ? resolve(folder) : dirname(fileURLToPath(import.meta.resolve('@missing-elements/h5p-libraries/parts/index.json')))
}

/**
 * The pack a build reads: the one this package pins, or the `parts/` folder of another copy. Read
 * from its `index.json`, which names the libraries carried for an H5P site's upload check too,
 * where the `pack` export of `index.js` leaves them out.
 * @param {string} [folder] a folder holding `index.json` and the parts it names
 */
export async function openPack(folder) {
  const directory = partsFolder(folder)
  const origin = folder ? directory : '@missing-elements/h5p-libraries'
  let index
  try {
    index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))
  } catch (error) {
    throw new Error(`${directory} is not a library pack's parts folder: it has no readable index.json`, { cause: error })
  }
  if (!Array.isArray(index?.libraries)) throw new Error(`${join(directory, 'index.json')} lists no libraries`)
  /** @type {import('./pack.mjs').IndexEntry[]} */
  const libraries = index.libraries.map((/** @type {import('./pack.mjs').IndexEntry} */ entry) => ({ ...entry, url: pathToFileURL(join(directory, `${entry.folder}.h5p`)).href }))
  return new Pack(libraries, async (entry) => {
    try {
      return new Uint8Array(await readFile(fileURLToPath(entry.url)))
    } catch (error) {
      // A content type's bundle holds what the type can hold, and no addon: a source whose text
      // calls for one, or another type's library, needs its part added.
      if (folder && /** @type {{ code?: unknown }} */ (error)?.code === 'ENOENT') {
        throw new Error(`The parts folder ${directory} has no ${entry.folder}.h5p, which this package needs: add it from the library pack's parts/`)
      }
      throw new Error(`Cannot read the library part ${entry.folder} from ${origin}`, { cause: error })
    }
  }, 'reinstall the pack')
}

/**
 * The pinned pack's version, for messages and reports, from the libraries package's package.json
 * where it is installed beside this one. The command line as one file, `dist/h5p-author.mjs`,
 * copied out of the package, has no package beside it: there it is the copy its bundler wrote in
 * from the import. The file comes first, since Node before 22.12 warns on a JSON import.
 */
export async function packVersion() {
  try {
    const url = import.meta.resolve('@missing-elements/h5p-libraries/package.json')
    return String(JSON.parse(await readFile(fileURLToPath(url), 'utf8')).version)
  } catch {
    return (await import('@missing-elements/h5p-libraries/package.json', { with: { type: 'json' } })).default.version
  }
}

/**
 * A source's files on disk: beside the source, by their paths from `base`; downloads kept in
 * `temporary`, numbered.
 * @param {{ base: string, temporary: string, within?: string[] }} folders `within`, the folders a file must be inside
 * @returns {import('./media.mjs').MediaAccess<string>}
 * @internal
 */
export function nodeMedia({ base, temporary, within }) {
  let downloads = 0
  return {
    what: 'a file beside the source',
    name: (source) => basename(resolve(base, source)),
    async local(source) {
      const from = resolve(base, source)
      // Judged before the file is looked for, so a path outside is answered the same whether
      // or not something is there, and a confined build names no path but the one written.
      if (within && !(await inside(from, within))) return { missing: 'is outside the folders this build may read' }
      const found = await stat(from).catch(() => null)
      if (!found?.isFile()) return { missing: within ? 'no such file in the folders this build may read' : `no such file beside the source (${from})` }
      // Opened once here, so a file the build cannot read is a problem of the source's, said with
      // the rest, and not a failure halfway through the build that names its whole path.
      try {
        await (await open(from, 'r')).close()
      } catch {
        return { missing: within ? 'cannot be read' : `cannot be read (${from})` }
      }
      return { file: from }
    },
    async keep(body, extension) {
      downloads += 1
      const from = join(temporary, `download-${downloads}.${extension}`)
      await body.pipeTo(/** @type {WritableStream<Uint8Array>} */ (Writable.toWeb(createWriteStream(from))))
      return from
    },
    async open(file) {
      const handle = await open(file, 'r')
      const { size } = await handle.stat().catch(async (error) => {
        await handle.close()
        throw error
      })
      return {
        size,
        async read(offset, length) {
          const bytes = new Uint8Array(length)
          const { bytesRead } = await handle.read(bytes, 0, length, offset)
          return bytes.subarray(0, bytesRead)
        },
        close: () => handle.close()
      }
    }
  }
}

/**
 * A path as the file system resolves it, links followed; of a path that does not exist yet, its
 * nearest folder that does, with the rest of the path after it. Undefined where nothing on it exists.
 * @param {string} path
 */
async function resolved(path) {
  let real = resolve(path)
  const tail = []
  for (;;) {
    try {
      return join(await realpath(real), ...tail.reverse())
    } catch {
      const parent = dirname(real)
      if (parent === real) return undefined
      tail.push(basename(real))
      real = parent
    }
  }
}

/**
 * Whether a path, as the file system resolves it, a link followed, is in one of the folders.
 * A path or a folder that does not exist yet is judged by its nearest folder that does.
 * @param {string} path
 * @param {string[]} folders
 */
export async function inside(path, folders) {
  const real = await resolved(path)
  if (real === undefined) return false
  for (const folder of folders) {
    const root = (await resolved(folder)) ?? resolve(folder)
    const from = relative(root, real)
    // `..notes.png` is a name in the folder; only `..` itself, or a path through it, leaves it.
    if (!isAbsolute(from) && from !== '..' && !from.startsWith(`..${sep}`)) return true
  }
  return false
}

/**
 * Every network that is not the public internet, as `BlockList` reads it, which matches an IPv4
 * address however it is written: `::ffff:127.0.0.1` and `::ffff:7f00:1` are 127.0.0.1, and a URL
 * writes the first as the second. IPv4: this network, private, carrier-grade NAT, loopback,
 * link-local, IETF protocol assignments, documentation (TEST-NET-1 to 3), benchmarking, multicast
 * and reserved; and each of those as IPv6 carries it to an IPv4 network, behind NAT64's well-known
 * prefix (`64:ff9b::/96`, RFC 6052), which a NAT64 gateway translates, and in 6to4 (`2002::/16`).
 * IPv6: the unspecified and loopback addresses with the IPv4-compatible ones (`::/96`), the
 * IPv4-translated ones (`::ffff:0:0:0/96`, RFC 2765), NAT64's local-use prefix (`64:ff9b:1::/48`,
 * RFC 8215), discard-only (`100::/64`), Teredo (`2001::/32`), which carries an IPv4 address,
 * benchmarking (`2001:2::/48`), documentation (`2001:db8::/32`, `3fff::/20`), segment routing's
 * (`5f00::/16`), unique-local, link-local, site-local and multicast.
 */
const LOCAL_NETWORKS = new BlockList()
for (const [address, prefix] of /** @type {[string, number][]} */ ([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3]
])) {
  LOCAL_NETWORKS.addSubnet(address, prefix, 'ipv4')
  const [a, b, c, d] = address.split('.').map(Number)
  const high = ((a << 8) | b).toString(16)
  const low = ((c << 8) | d).toString(16)
  LOCAL_NETWORKS.addSubnet(`64:ff9b::${high}:${low}`, 96 + prefix, 'ipv6')
  LOCAL_NETWORKS.addSubnet(`2002:${high}:${low}::`, 16 + prefix, 'ipv6')
}
for (const [address, prefix] of /** @type {[string, number][]} */ ([
  ['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:2::', 48], ['2001:db8::', 32], ['3fff::', 20],
  ['5f00::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
])) {
  LOCAL_NETWORKS.addSubnet(address, prefix, 'ipv6')
}

/**
 * Whether an IP address is on no public network (`LOCAL_NETWORKS`). Text that is no address is
 * taken as one, so a check it cannot read refuses.
 * @param {string} address
 */
export function isPrivateAddress(address) {
  const family = isIP(address)
  return family === 0 || LOCAL_NETWORKS.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

/**
 * @typedef {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} Fetch
 * @typedef {(host: string, options: { all: true }) => Promise<{ address: string }[]>} Lookup
 */

/** What a request carries for its own site, which a redirect to another does not, as `fetch` drops them. */
const CREDENTIALS = ['authorization', 'proxy-authorization', 'cookie']

/**
 * A promise that settles as the one given does, or rejects with the signal's reason once it
 * aborts: a lookup takes no signal of its own, so a resolver that hangs would hold a build past
 * its download's idle limit.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal | null | undefined} signal
 * @returns {Promise<T>}
 */
function abortable(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * A `fetch` that refuses an address on a local network (`isPrivateAddress`), on every redirect it
 * follows, over the resolver and `fetch` given: the tests' seam. `publicFetch` is this over the
 * system's. As `fetch` does, a redirect to another origin drops what the request carried for its
 * own: `Authorization`, `Proxy-Authorization` and `Cookie`.
 * @param {{ lookup?: Lookup, fetch?: Fetch }} [over]
 * @returns {Fetch}
 * @internal
 */
export function guardedFetch({ lookup: resolveHost = lookup, fetch: send = (input, init) => fetch(input, init) } = {}) {
  return async function guarded(input, init = {}) {
    const request = input instanceof Request ? input : undefined
    let url = new URL(request ? request.url : String(input))
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') throw new TypeError(`fetches media, by GET or HEAD, not by ${method}`)
    const mode = init.redirect ?? request?.redirect ?? 'follow'
    const headers = new Headers(init.headers ?? request?.headers)
    const signal = init.signal ?? request?.signal
    const options = { ...init, method, headers, signal, redirect: /** @type {const} */ ('manual') }
    for (let hops = 0; hops <= 10; hops++) {
      if (!/^https?:$/.test(url.protocol)) throw new TypeError(`${url.protocol} addresses are not fetched`)
      const host = url.hostname.replace(/^\[|\]$/g, '')
      // An aborted request asks no resolver.
      signal?.throwIfAborted()
      /** @type {{ address: string }[]} */
      let addresses = []
      if (isIP(host)) addresses = [{ address: host }]
      else {
        try {
          addresses = await abortable(resolveHost(host, { all: true }), signal)
        } catch (error) {
          if (signal?.aborted) throw error
        }
      }
      // A name that does not resolve is answered as a local one is, so a refusal does not tell
      // which names a local network has.
      if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new TypeError(`${url.hostname} is not on the public internet, the only place a build here fetches from`)
      const response = await send(url, options)
      const next = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || !next || mode === 'manual') {
        Object.defineProperty(response, 'url', { value: url.href })
        return response
      }
      await response.body?.cancel()
      if (mode === 'error') throw new TypeError(`${url.href} redirects, and redirects were refused`)
      const target = new URL(next, url)
      if (target.origin !== url.origin) for (const name of CREDENTIALS) headers.delete(name)
      url = target
    }
    throw new TypeError('more than 10 redirects')
  }
}

/**
 * A `fetch` for media that refuses an address on a local network, on every redirect it follows:
 * for a build that acts on what a model wrote, where the command line's own may reach any host.
 * A build uses it only where it is passed as `fetch`. It looks a name up and then asks, so a host
 * that answers differently the second time is not covered: it is a guard against a model's
 * mistake or a planted address, not against a hostile network. A name that does not resolve is
 * refused in the words a local one is, so what it refuses does not tell which names exist on a
 * local network. GET and HEAD only, as media is fetched.
 */
export const publicFetch = guardedFetch()

/**
 * The refusal of an output that exists, with the file system's code, so a caller tells it from
 * a source's problems.
 * @param {string} output
 * @param {string} [what] what refuses
 */
function exists(output, what = 'a build') {
  return Object.assign(new Error(`${output} exists, and ${what} never writes over a file: name a new one`), { code: 'EEXIST' })
}

/**
 * `within` as given, checked: a list of folders, or none. One folder given alone, as a string,
 * would be read as a list of its characters, `/` among them, which confines nothing.
 * @param {unknown} within
 * @returns {string[] | undefined}
 */
function foldersOf(within) {
  if (within === undefined) return undefined
  if (!Array.isArray(within) || !within.every((folder) => typeof folder === 'string' && folder.trim())) {
    throw new TypeError('within takes a list of folders: [folder]')
  }
  return within
}

/**
 * Builds a package from a source and writes it to `output`, which must not exist yet; with
 * `check`, builds it and writes none, and takes no `output`.
 * @param {unknown} input the source: `{ type, title, language, license, authors, params }`, or a quiz in the published quiz format
 * @param {string | undefined} output the package's path; `undefined` with `check`
 * @param {BuildOptions} [options]
 * @returns {Promise<BuildResult>}
 */
export async function buildPackage(input, output, options = {}) {
  const { check = false } = options
  const within = foldersOf(options.within)
  if (!check && (typeof output !== 'string' || !output.trim())) throw new TypeError('a build takes the path to write its package to, and a check (check: true) none')
  // A check writes nothing, so where a package would go is not looked at.
  const target = check ? '' : resolve(/** @type {string} */ (output))
  if (!check) {
    if (within && !(await inside(target, within))) throw new Error(`${target} is outside the folders this build may write in`)
    // Before any work, and again as the package lands, for a file that appears in between.
    if (await lstat(target).then(() => true, () => false)) throw exists(target)
    if (!(await stat(dirname(target)).catch(() => null))?.isDirectory()) throw new Error(`${dirname(target)} is not a folder to write the package in`)
  }
  const pack = await openPack(options.libraries)
  let temporary
  try {
    // With the pack's names, so that a content type named loosely is known, and the content of a
    // source whose own fields have problems is checked in the same round (#174).
    const read = sourceOf(input, typeNames(pack))
    if (!read.typed) throw new SourceError(read.problems)
    temporary = await mkdtemp(join(check ? tmpdir() : dirname(target), '.h5p-author-'))
    const media = new MediaStore(nodeMedia({ base: options.base ?? process.cwd(), temporary, within }), { fetch: options.fetch })
    const built = await composePackage(read.source, pack, media, read.problems)
    if (check) {
      return {
        output: '',
        manifest: built.manifest,
        content: built.content,
        libraries: [...built.selected.keys()],
        install: [...built.install.keys()],
        coreApi: built.coreApi,
        translations: built.translations,
        notes: built.notes,
        media: media.files.map((item) => item.name),
        get outline() { return built.outline }
      }
    }
    const staged = join(temporary, 'package.h5p')
    const file = await open(staged, 'wx')
    try {
      const writer = new ZipWriter(Writable.toWeb(file.createWriteStream()), { useWebWorkers: false })
      await writePackage(writer, built, pack, async () => {
        for (const item of media.files) {
          await writer.add(`content/${item.name}`, /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(createReadStream(item.from))), { level: 0 })
        }
      })
      await writer.close()
    } finally {
      await file.close()
    }
    let final = staged
    if (media.files.length) {
      // Media stored, an mp4's index first: the layout a package streams in. The libraries
      // carried for an H5P site's upload check stay after the media, where `writePackage` put
      // them: a host that ignores `Range` then boots, and plays the media, before they arrive.
      final = join(temporary, 'normalized.h5p')
      await normalizeArchive({ input: staged, output: final, last: [...built.install.keys()] })
    }
    // Unlike a hard link, an exclusive copy also works on FAT/exFAT destinations.
    await copyFile(final, target, constants.COPYFILE_EXCL).catch((error) => {
      throw error?.code === 'EEXIST' ? exists(target) : error
    })
    return {
      output: target,
      manifest: built.manifest,
      content: built.content,
      libraries: [...built.selected.keys()],
      install: [...built.install.keys()],
      coreApi: built.coreApi,
      translations: built.translations,
      notes: built.notes,
      media: media.files.map((item) => item.name),
      get outline() { return built.outline }
    }
  } finally {
    await pack.close()
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}

/**
 * Whether a media path a package's content names is one a read writes a file at, under its folder:
 * names joined by `/`, none of them empty, `.` or `..`, and none with a character a file name
 * cannot have on Windows, macOS or Linux. An archive is untrusted, and its content names paths.
 * @param {string} path
 */
function writable(path) {
  return path.split('/').every((name) => name !== '' && name !== '.' && name !== '..' && !/[\\:*?"<>|\u0000-\u001f]/.test(name))
}

/**
 * A package read back into the source a build would take to make it again (#236), to change it and
 * build it again: written into `folder`, made where it is not there, as `<name>.source.json`, with
 * the package's media beside it at the paths the source names them by. Only the media the content
 * names are written, and only under the folder, since an archive is untrusted: a file whose path
 * is no name a read writes is left out of the source, which so names no file outside the folder,
 * and a read that a link in the folder would take outside it writes nothing. Nothing is written
 * over: where a name is taken, nothing is written, and what was written is taken away again where
 * a later write fails.
 * @param {string} file the package, a .h5p
 * @param {string} folder
 * @param {ReadOptions} [options]
 * @returns {Promise<ReadResult>}
 */
export async function readPackage(file, folder, options = {}) {
  const within = foldersOf(options.within)
  const input = resolve(file)
  const target = resolve(folder)
  if (within && !(await inside(input, within))) throw new Error(`${input} is outside the folders this read may use`)
  if (within && !(await inside(target, within))) throw new Error(`${target} is outside the folders this read may write in`)
  const blob = await openAsBlob(input).catch((error) => {
    throw new Error(`${input} cannot be read: ${error?.code === 'ENOENT' ? 'there is no such file' : error instanceof Error ? error.message : error}`)
  })
  const reader = new ZipReader(new BlobReader(blob))
  try {
    /** @type {Map<string, import('@zip.js/zip.js').FileEntry>} */
    const entries = new Map()
    try {
      for (const entry of await reader.getEntries()) if (!entry.directory) entries.set(entry.filename, entry)
    } catch (error) {
      // zip.js refuses a name that leads out of the archive's folders, as `../` does.
      if (error instanceof Error && error.message === ERR_UNSAFE_FILENAME) {
        throw new Error(`${input} has an entry named ${JSON.stringify(/** @type {{ filename?: unknown }} */ (error).filename)}, which leads out of its folders: an archive like that is not read`)
      }
      throw new Error(`${input} is not a zip, as a .h5p is`, { cause: error })
    }
    const json = async (/** @type {string} */ name) => {
      const entry = entries.get(name)
      if (!entry) throw new Error(`${input} has no ${name}: it is not an H5P package`)
      try {
        return JSON.parse(await entry.getData(new TextWriter()))
      } catch (error) {
        throw new Error(`${name} in ${input} is not JSON`, { cause: error })
      }
    }
    const saved = { manifest: await json('h5p.json'), content: await json('content/content.json') }
    const pack = await openPack(options.libraries)
    let read
    try {
      read = await readContent(pack, saved)
    } finally {
      await pack.close()
    }
    const notes = [...read.notes]
    const output = join(target, `${basename(input).replace(/\.h5p$/i, '') || 'package'}.source.json`)
    /** @type {{ entry: import('@zip.js/zip.js').FileEntry, to: string, path: string }[]} */
    const media = []
    /** @type {Set<string>} */
    const unwritable = new Set()
    for (const path of read.files) {
      if (!writable(path)) {
        // Such a path may lead anywhere, which a build of the source would read from.
        unwritable.add(path)
        notes.push({ path: 'params', message: `names the file ${JSON.stringify(path)}, which is no path a read writes a file at: left out of the source` })
        continue
      }
      let decoded = path
      try {
        decoded = decodeURIComponent(path)
      } catch {
        // Not encoded: the name as it is.
      }
      const entry = entries.get(`content/${path}`) ?? entries.get(`content/${decoded}`)
      if (!entry) notes.push({ path: 'params', message: `names the file ${path}, which is not in the package: a build of this source asks for it` })
      else media.push({ entry, to: join(target, ...path.split('/')), path })
    }
    const source = unwritable.size ? /** @type {import('./build.mjs').Source} */ (withoutFiles(read.source, unwritable)) : read.source
    // Every name looked at before anything is made, so a read that cannot write all of it writes
    // nothing: none taken, and none that a link on the way, which the folder may hold, takes out
    // of it. The archive names the paths.
    for (const to of [output, ...media.map((each) => each.to)]) {
      if (await lstat(to).then(() => true, () => false)) throw exists(to, 'a read')
      if (!(await inside(to, [target]))) throw new Error(`${to} leads out of ${target} through a link on its way: a read writes only in its folder`)
    }
    /** @type {{ path: string, made: Made }[]} */
    const made = []
    /** @type {{ first: string, last: string }[]} the folders made, each `mkdir`'s from the first it made to the last */
    const folders = []
    /** @param {string} path */
    const makeFolder = async (path) => {
      const first = await mkdir(path, { recursive: true })
      if (first) folders.push({ first, last: path })
    }
    /** @param {string} to @param {(file: import('node:fs/promises').FileHandle) => Promise<void>} write */
    const create = async (to, write) => {
      await makeFolder(dirname(to))
      const handle = await open(to, 'wx').catch((error) => {
        throw error?.code === 'EEXIST' ? exists(to, 'a read') : error
      })
      try {
        const { dev, ino } = await handle.stat({ bigint: true })
        made.push({ path: to, made: { dev, ino } })
        await write(handle)
      } finally {
        await handle.close()
      }
    }
    try {
      await makeFolder(target)
      for (const { entry, to } of media) {
        // Through the handle itself: a stream made from it would hold it open past the last byte.
        await create(to, (handle) => entry.getData(new WritableStream({
          async write(chunk) {
            for (let done = 0; done < chunk.length;) done += (await handle.write(chunk, done, chunk.length - done)).bytesWritten
          }
        })).then(() => undefined))
      }
      await create(output, (handle) => handle.writeFile(`${JSON.stringify(source, null, 2)}\n`))
    } catch (error) {
      await Promise.all(made.map(({ path, made: file }) => removeIfMade(path, file)))
      // Then the folders it made, the deepest first, where they are empty: what another process has
      // put in one since keeps it.
      for (const { first, last } of folders.reverse()) {
        for (let path = last; ; path = dirname(path)) {
          await rmdir(path).catch(() => {})
          if (path === first || dirname(path) === path) break
        }
      }
      throw error
    }
    return { output, source, files: media.map((each) => each.path), notes }
  } finally {
    await reader.close()
  }
}

/**
 * A source without the files at `paths`: one in a list is taken out of it, any other left unwritten.
 * @param {unknown} value
 * @param {Set<string>} paths
 * @returns {unknown}
 */
function withoutFiles(value, paths) {
  /** @param {unknown} each */
  const named = (each) => each !== null && typeof each === 'object' && typeof (/** @type {any} */ (each).path) === 'string' && paths.has(/** @type {any} */ (each).path)
  if (Array.isArray(value)) return value.filter((each) => !named(each)).map((each) => withoutFiles(each, paths))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([, each]) => !named(each)).map(([key, each]) => [key, withoutFiles(each, paths)]))
}

/** The date on every entry of a bundle, as on the pack's parts: a bundle of the same pack is the same bytes. */
const BUNDLE_DATE = new Date(2000, 0, 1, 2)

/**
 * A content type's bundle (`bundleLibraries`) written to `output`, which must not exist yet: a zip
 * of `parts/`, a parts folder `h5p-author build --libraries parts` reads, with the pack's whole index
 * and the parts a build of the type reads, and of `libraries.txt`, the licences those are used under,
 * as the pack lists them beside its parts folder. Two bundles of the same pack unzipped in one place
 * make one parts folder: their index is the same.
 * @param {string} type a content type's machine name, such as `H5P.QuestionSet`
 * @param {string} output
 * @param {{ libraries?: string }} [options] `libraries`, a pack's parts folder in place of the pinned pack
 * @returns {Promise<BundleResult>}
 */
export async function writeBundle(type, output, options = {}) {
  output = resolve(output)
  if (await lstat(output).then(() => true, () => false)) throw exists(output, 'h5p-author')
  if (!(await stat(dirname(output)).catch(() => null))?.isDirectory()) throw new Error(`${dirname(output)} is not a folder to write the bundle in`)
  const files = await bundleFiles(partsFolder(options.libraries))
  const pack = await openPack(options.libraries)
  try {
    return (await writeZip(pack, files, await bundleLibraries(pack, type), output)).result
  } finally {
    await pack.close()
  }
}

/**
 * Every content type's bundle (`contentTypes`), written as `writeBundle` writes one, to
 * `<machine name>.zip` in `folder`, which is made if it is not there. Nothing is written over: where
 * one of them is there already, nothing is written. All of them or none: one that fails takes those
 * written before it away again, so the call can be run again as it was. A file another process has
 * put at one of those names since is theirs, and stays.
 * @param {string} folder
 * @param {{ libraries?: string }} [options] `libraries`, a pack's parts folder in place of the pinned pack
 * @returns {Promise<BundleResult[]>} by machine name
 */
export async function writeBundles(folder, options = {}) {
  folder = resolve(folder)
  const files = await bundleFiles(partsFolder(options.libraries))
  const pack = await openPack(options.libraries)
  try {
    const types = (await contentTypes(pack)).map((part) => part.library.machineName)
    const outputs = types.map((type) => join(folder, `${type}.zip`))
    for (const output of outputs) if (await lstat(output).then(() => true, () => false)) throw exists(output, 'h5p-author')
    await mkdir(folder, { recursive: true })
    /** @type {{ result: BundleResult, made: Made }[]} */
    const written = []
    try {
      for (const [i, type] of types.entries()) written.push(await writeZip(pack, files, await bundleLibraries(pack, type), outputs[i]))
    } catch (error) {
      // Only what this call made: a name is taken away if it still holds the file this call
      // created, not if another process has replaced that since.
      await Promise.all(written.map(({ result, made }) => removeIfMade(result.output, made)))
      throw error
    }
    return written.map(({ result }) => result)
  } finally {
    await pack.close()
  }
}

/**
 * What every bundle of a pack carries besides its parts: the index as the pack has it, and the
 * licence list beside its parts folder, without which the parts are not handed on.
 * @param {string} directory the pack's parts folder
 */
async function bundleFiles(directory) {
  const index = await readFile(join(directory, 'index.json')).catch((error) => {
    throw new Error(`${directory} is not a library pack's parts folder: it has no readable index.json`, { cause: error })
  })
  const listed = join(dirname(directory), 'libraries.txt')
  const licences = await readFile(listed).catch((error) => {
    throw new Error(`${listed} cannot be read: a bundle carries the licences its libraries are used under, the list a pack keeps beside its parts/ folder`, { cause: error })
  })
  return { index: new Uint8Array(index), licences: new Uint8Array(licences) }
}

/**
 * Takes away a file this module created, unless the name holds another file by now. A file another
 * process has put there since is theirs, and removing by the name alone would take it. A guard,
 * not a lock: the check and the removal are two calls, and Node removes a file by its name, so a
 * file that takes the name in the gap between them is still lost.
 * @param {string} path
 * @param {Made} made
 * @returns {Promise<void>}
 * @internal
 */
export async function removeIfMade(path, made) {
  const now = await lstat(path, { bigint: true }).catch(() => null)
  if (now && now.dev === made.dev && now.ino === made.ino) await rm(path, { force: true })
}

/**
 * A bundle's zip, created at `output`, and removed again if it cannot be written whole.
 * @param {Pack} pack with every part of `parts` opened, and so checked against the index
 * @param {{ index: Uint8Array, licences: Uint8Array }} files
 * @param {import('./pack.mjs').IndexEntry[]} parts the content type's first
 * @param {string} output
 * @returns {Promise<{ result: BundleResult, made: Made }>} `made`, the file as created, for a caller
 *   that takes it away again if a later one fails
 */
async function writeZip(pack, { index, licences }, parts, output) {
  const file = await open(output, 'wx').catch((error) => {
    throw error?.code === 'EEXIST' ? exists(output, 'h5p-author') : error
  })
  /** @type {Made | undefined} */
  let made
  try {
    try {
      const { dev, ino } = await file.stat({ bigint: true })
      made = { dev, ino }
      const writer = new ZipWriter(Writable.toWeb(file.createWriteStream()), { useWebWorkers: false, lastModDate: BUNDLE_DATE, extendedTimestamp: false })
      await writer.add('parts/index.json', new Uint8ArrayReader(index))
      // A part is a zip already: stored as it is, the bytes checked against the index as it opened.
      for (const entry of parts) await writer.add(`parts/${entry.folder}.h5p`, pack.archiveOf(entry), { level: 0 })
      await writer.add('libraries.txt', new Uint8ArrayReader(licences))
      await writer.close()
    } finally {
      await file.close()
    }
  } catch (error) {
    // The file as created, if it is still there; one that could not be looked at was made a moment ago.
    if (made) await removeIfMade(output, made)
    else await rm(output, { force: true })
    throw error
  }
  const [main] = parts
  return {
    result: { output, type: `${main.machineName} ${main.majorVersion}.${main.minorVersion}`, parts: parts.map((entry) => entry.folder), size: (await stat(output)).size },
    made: /** @type {Made} */ (made)
  }
}
