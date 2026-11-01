import { createWriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { escapeText } from './text.mjs'

/**
 * The files content shows: images, video, audio and other files, named in a source by a path
 * beside it or a web address, copied into the package's `content/` folder with what H5P records
 * of each — its type, an image's size, its copyright. A video on YouTube, Vimeo or Panopto stays
 * there and is played from there, as H5P's editor embeds it.
 */

/** The types H5P accepts for content (`H5PCore::$defaultContentWhitelist`), by what a field takes. */
const TYPES = {
  image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' },
  video: { mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg' },
  audio: { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm' },
  file: {
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', vtt: 'text/vtt', webvtt: 'text/vtt', rtf: 'application/rtf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', mp3: 'audio/mpeg', mp4: 'video/mp4', json: 'application/json'
  }
}

/** The folder under `content/` H5P's editor keeps each kind in. */
const FOLDERS = { image: 'images', video: 'videos', audio: 'audios', file: 'files' }

/** Video a host plays itself, which H5P.Video embeds by address. */
const HOSTED = [
  { pattern: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?|embed\/|shorts\/)|youtu\.be\/)/i, mime: 'video/YouTube' },
  { pattern: /^https?:\/\/(?:www\.|player\.)?vimeo\.com\//i, mime: 'video/Vimeo' },
  { pattern: /^https?:\/\/[^/]+\.panopto\.(?:com|eu)\//i, mime: 'video/Panopto' }
]

/** The licences a file's copyright may name, as H5P lists them. */
const COPYRIGHT_LICENSES = ['U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'GNU GPL', 'PD', 'C']

/** The most a download may bring: a package of this size is already past what a learner waits for. */
const MAX_DOWNLOAD = 1024 ** 3

/**
 * @typedef {{ name: string, from: string }} StagedFile a file to add to the package: its name under `content/`, and where it is on disk
 * @typedef {{ path: string, message: string }} Problem
 */

/**
 * An image's width and height, read from its header: PNG, JPEG, GIF and BMP.
 * @param {Uint8Array} bytes the first bytes of the file, 64 kB or the whole of a smaller one
 * @returns {{ width: number, height: number } | null}
 * @internal
 */
export function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (/** @type {number} */ offset, /** @type {number} */ length) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') return { width: view.getUint32(16), height: view.getUint32(20) }
  if (bytes.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  if (bytes.length >= 26 && ascii(0, 2) === 'BM') return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]
      if (marker === 0xff) {
        offset += 1
        continue
      }
      const length = view.getUint16(offset + 2)
      // A start-of-frame marker, baseline to lossless, holds the size; DHT, JPG and DAC do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
      }
      offset += 2 + length
    }
  }
  return null
}

/**
 * Whether an mp4 has its index (`moov`) before its media (`mdat`), so it plays before it has all
 * arrived. Read from the top-level boxes; an unreadable file counts as fine, since the normalizer
 * leaves what it cannot read alone.
 * @param {string} file
 * @internal
 */
export async function isFaststart(file) {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    let offset = 0
    const header = new Uint8Array(16)
    while (offset + 8 <= size) {
      await handle.read(header, 0, 16, offset)
      const view = new DataView(header.buffer)
      let length = view.getUint32(0)
      const type = String.fromCharCode(...header.subarray(4, 8))
      if (length === 1) length = Number(view.getBigUint64(8))
      else if (length === 0) length = size - offset
      if (type === 'moov') return true
      if (type === 'mdat') return false
      if (length < 8) return true
      offset += length
    }
    return true
  } finally {
    await handle.close()
  }
}

export class MediaStore {
  /**
   * @param {{ base: string, temporary: string, fetch?: typeof fetch }} options
   *   `base`, the folder a source's relative paths are read from; `temporary`, where downloads land
   */
  constructor({ base, temporary, fetch: fetchImpl = globalThis.fetch }) {
    this.base = base
    this.temporary = temporary
    this.fetch = fetchImpl
    /** @type {StagedFile[]} */
    this.files = []
    /** @type {Map<string, { name: string, mime: string, width?: number, height?: number }>} by source, so one file named twice is copied once */
    this.known = new Map()
    /** @type {Set<string>} */
    this.names = new Set()
    this.downloads = 0
    /** Whether a video has its index at the end, which the build then moves to the front. */
    this.slowStart = false
  }

  /**
   * A written file made what H5P stores: `{ path, mime, width?, height?, copyright }`, its bytes
   * staged for the package.
   * @param {any} field the image, video, audio or file field
   * @param {{ path: string, copyright?: any }} value as written
   * @param {string} at where it is written, for problems
   * @param {(path: string, message: string) => void} report
   * @returns {Promise<Record<string, unknown>>}
   */
  async resolve(field, value, at, report) {
    const kind = /** @type {'image' | 'video' | 'audio' | 'file'} */ (field.type)
    const source = value.path.trim()
    const copyright = this.copyright(value.copyright, `${at}.copyright`, report)
    const web = /^https?:\/\//i.test(source)
    if (web && kind === 'video') {
      const hosted = HOSTED.find(({ pattern }) => pattern.test(source))
      if (hosted) return { path: source, mime: hosted.mime, copyright }
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !web) {
      report(`${at}.path`, 'expected a file beside the source or an http(s) address')
      return { path: source, copyright }
    }
    const types = /** @type {Record<string, string>} */ (TYPES[kind])
    let known = this.known.get(source)
    if (!known) {
      const staged = web ? await this.#download(source, kind, types, at, report) : await this.#local(source, types, at, report)
      if (!staged) return { path: source, copyright }
      const extension = staged.extension
      const mime = types[extension]
      const name = this.#name(FOLDERS[kind], staged.stem, extension)
      /** @type {{ name: string, mime: string, width?: number, height?: number }} */
      const described = { name, mime }
      if (kind === 'image') {
        const handle = await open(staged.from, 'r')
        try {
          const head = new Uint8Array(65536)
          const { bytesRead } = await handle.read(head, 0, head.length, 0)
          const size = imageSize(head.subarray(0, bytesRead))
          if (!size) report(`${at}.path`, `${source} is not a ${extension.toUpperCase()} image whose size can be read`)
          else Object.assign(described, size)
        } finally {
          await handle.close()
        }
      }
      if (kind === 'video' && mime === 'video/mp4' && !(await isFaststart(staged.from))) this.slowStart = true
      this.files.push({ name, from: staged.from })
      this.known.set(source, described)
      known = described
    }
    const { name, ...rest } = known
    return { path: name, ...rest, copyright }
  }

  /**
   * A file's copyright as H5P records it: a licence, and its author, title, year, source and
   * version when given, as plain text.
   * @param {unknown} written
   * @param {string} at
   * @param {(path: string, message: string) => void} report
   */
  copyright(written, at, report) {
    if (written === undefined) return { license: 'U' }
    if (!written || typeof written !== 'object' || Array.isArray(written)) return { license: 'U' }
    const value = /** @type {Record<string, unknown>} */ (written)
    /** @type {Record<string, string>} */
    const out = { license: 'U' }
    for (const [key, entry] of Object.entries(value)) {
      if (!['license', 'author', 'title', 'year', 'source', 'version'].includes(key)) {
        report(`${at}.${key}`, 'is not part of a copyright; write license, author, title, year, source or version')
        continue
      }
      if (typeof entry !== 'string' || !entry.trim()) {
        report(`${at}.${key}`, 'expected text')
        continue
      }
      if (key === 'license' && !COPYRIGHT_LICENSES.includes(entry)) report(`${at}.license`, `use one of ${COPYRIGHT_LICENSES.join(', ')}`)
      if (key === 'source' && !/^https?:\/\/.+/i.test(entry)) report(`${at}.source`, 'expected an http(s) address')
      out[key] = key === 'license' || key === 'version' ? entry : escapeText(entry)
    }
    return out
  }

  /**
   * @param {string} source
   * @param {Record<string, string>} types
   * @param {string} at
   * @param {(path: string, message: string) => void} report
   */
  async #local(source, types, at, report) {
    const from = resolve(this.base, source)
    const extension = extname(from).slice(1).toLowerCase()
    if (!(extension in types)) {
      report(`${at}.path`, `${source}: this field takes ${Object.keys(types).map((each) => `.${each}`).join(', ')}`)
      return null
    }
    try {
      const info = await stat(from)
      if (!info.isFile()) throw new Error('not a file')
    } catch {
      report(`${at}.path`, `${source}: no such file beside the source (${from})`)
      return null
    }
    return { from, extension, stem: basename(from, extname(from)) }
  }

  /**
   * A web address downloaded to the temporary folder, its type taken from its name or, failing
   * that, from what the server says it is.
   * @param {string} source
   * @param {string} kind
   * @param {Record<string, string>} types
   * @param {string} at
   * @param {(path: string, message: string) => void} report
   */
  async #download(source, kind, types, at, report) {
    let url
    try {
      url = new URL(source)
    } catch {
      report(`${at}.path`, `${source} is not a web address`)
      return null
    }
    let response
    try {
      response = await this.fetch(url.href, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
    } catch (error) {
      report(`${at}.path`, `${source} could not be downloaded: ${error instanceof Error ? error.message : error}`)
      return null
    }
    if (!response.ok || !response.body) {
      report(`${at}.path`, `${source} answered ${response.status}${kind === 'video' ? '; for YouTube, Vimeo or Panopto give the video page\'s address' : ''}`)
      return null
    }
    const named = extname(new URL(response.url || url.href).pathname).slice(1).toLowerCase()
    const served = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const extension = named in types ? named : Object.keys(types).find((each) => types[each] === served)
    if (!extension) {
      await response.body.cancel()
      report(`${at}.path`, `${source} is ${served || 'of an unknown type'}: this field takes ${Object.keys(types).map((each) => `.${each}`).join(', ')}`)
      return null
    }
    this.downloads += 1
    const from = join(this.temporary, `download-${this.downloads}.${extension}`)
    let received = 0
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length
        callback(received > MAX_DOWNLOAD ? new Error(`larger than ${MAX_DOWNLOAD / 1024 ** 3} GB`) : null, chunk)
      }
    })
    try {
      await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)), limit, createWriteStream(from))
    } catch (error) {
      report(`${at}.path`, `${source} could not be downloaded: ${error instanceof Error ? error.message : error}`)
      return null
    }
    const stem = basename(decodeURIComponent(new URL(response.url || url.href).pathname), `.${named}`) || kind
    return { from, extension, stem }
  }

  /**
   * A name under `content/` for a file: its own, made safe, and numbered where another has it.
   * @param {string} folder
   * @param {string} stem
   * @param {string} extension
   */
  #name(folder, stem, extension) {
    const safe = stem.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || folder.slice(0, -1)
    let name = `${folder}/${safe}.${extension}`
    for (let count = 2; this.names.has(name.toLowerCase()); count++) name = `${folder}/${safe}-${count}.${extension}`
    this.names.add(name.toLowerCase())
    return name
  }
}
