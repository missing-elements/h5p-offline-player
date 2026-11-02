import { escapeText } from './text.mjs'

/**
 * The files content shows: images, video, audio and other files, named in a source by a path
 * beside it, by a name among the files a page was given, or by a web address, copied into the
 * package's `content/` folder with what H5P records of each — its type, an image's size, its
 * copyright. A video on YouTube, Vimeo, Panopto or Echo360 stays there and is played from there, as
 * H5P's editor embeds it (h5peditor-av.js, its `providers`), at an address H5P.Video plays. Where
 * the files are, and where a download is kept, is the environment's (`MediaAccess`): `node.mjs`
 * reads them from disk and keeps downloads in a temporary folder, `browser.mjs` takes `File`s and
 * keeps downloads as `Blob`s.
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

/** The folder under `content/` H5P's editor keeps each kind in (h5peditor-file.class.php). */
const FOLDERS = { image: 'images', video: 'videos', audio: 'audios', file: 'files' }

/** Whether a host name is one of these domains or under one. @param {string} host @param {string[]} domains */
const under = (host, domains) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`))

/**
 * Video a host plays itself, which H5P.Video embeds by address. H5P.Video chooses the player for
 * an address by its own pattern for each host, and gives one no pattern matches to its HTML5
 * player, which cannot play a page. So `plays` takes only addresses H5P.Video 1.6's pattern for
 * the host takes as well, and any other address on the host (`on`, told by its name, with no
 * pattern to backtrack through its labels) is refused, naming the form.
 * @type {{ host: string, mime: string, plays: RegExp, on: (url: URL) => boolean, form: string }[]}
 */
const HOSTED = [
  {
    host: 'Vimeo',
    mime: 'video/Vimeo',
    plays: /^https?:\/\/(?:[\w-]+\.)*vimeo\.com\/(?:channels\/[A-Za-z_]+\/|groups\/[A-Za-z_]+\/videos\/)?\d/,
    on: (url) => under(url.hostname, ['vimeo.com']),
    form: 'https://vimeo.com/ and the video\'s number'
  },
  {
    host: 'YouTube',
    mime: 'video/YouTube',
    plays: /^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|v\/)|youtu\.be\/)[\w-]{11}/i,
    on: (url) => under(url.hostname, ['youtube.com', 'youtube-nocookie.com', 'youtu.be']),
    form: 'https://www.youtube.com/watch?v= and the video\'s id'
  },
  {
    host: 'Panopto',
    mime: 'video/Panopto',
    plays: /^https?:\/\/[^/\s]+\/Panopto\/[^?\s]+\?id=\S+$/,
    on: (url) => under(url.hostname, ['panopto.com', 'panopto.eu']) || url.pathname.toLowerCase().startsWith('/panopto/'),
    form: 'the viewer\'s, …/Panopto/Pages/Viewer.aspx?id= and the session\'s id'
  },
  {
    host: 'Echo360',
    mime: 'video/Echo360',
    plays: /^https?:\/\/echo360[^/\s]+\/media\/[^/\s]+\/h5p(?:[/?#]\S*)?$/i,
    on: (url) => url.hostname.split('.').some((label) => label.startsWith('echo360')),
    form: 'its H5P address, https://echo360.org/media/, the media\'s id and /h5p'
  }
]

/** A YouTube Short or live stream, by its video's id, which H5P.Video plays at the watch address. */
const YOUTUBE_SHORT = /^https?:\/\/(?:[\w-]+\.)*youtube\.com\/(?:shorts|live)\/([\w-]{11})(?![\w-])/i

/** The licences a file's copyright may name, as H5P lists them. */
const COPYRIGHT_LICENSES = ['U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'GNU GPL', 'PD', 'C']

/** The most a download may bring: a package of this size is already past what a learner waits for. */
const MAX_DOWNLOAD = 1024 ** 3

/**
 * How long a download may go without a byte before it is given up. Not a bound on the whole: a
 * large video over a slow link takes as long as it takes, and only a silent one is dead.
 */
const IDLE_MS = 60_000

/**
 * @template F
 * @typedef {{ name: string, from: F }} StagedFile a file to add to the package: its name under `content/`, and where its bytes are
 * @typedef {{ path: string, message: string }} Problem
 */

/**
 * Where a build's files are, and where a download is kept, which differ between Node and a page.
 * @template F a kept file: a path on disk, or a `Blob`
 * @typedef {{
 *   what: string,
 *   name(source: string): string,
 *   local(source: string): Promise<{ file: F } | { missing: string }>,
 *   keep(body: ReadableStream<Uint8Array>, extension: string): Promise<F>,
 *   open(file: F): Promise<{ read(offset: number, length: number): Promise<Uint8Array>, close(): Promise<void> }>
 * }} MediaAccess
 *   `what`, what a source's path names, for problems; `name`, the file's own name it names;
 *   `local`, that file, or why there is none; `keep`, a download's bytes kept; `open`, a kept
 *   file's bytes read from an offset, fewer at its end
 */

/**
 * A file name's extension, lowercased, as Node's `extname` takes it: none for a name that only
 * starts with a dot.
 * @param {string} name
 */
function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * A path's last segment, past any slash it ends with, as Node's `basename` takes it.
 * @param {string} path
 */
function lastSegment(path) {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

/**
 * An image's width and height, read from its header: PNG, JPEG, GIF and BMP. A JPEG's are in its
 * frame header, which any number of other segments may come before, a colour profile or XMP among
 * them, so its segments are walked by their lengths, as far into the file as they go.
 * @param {(offset: number, length: number) => Promise<Uint8Array>} read the file's bytes from an offset, fewer at its end
 * @returns {Promise<{ width: number, height: number } | null>}
 * @internal
 */
export async function imageSize(read) {
  const head = await read(0, 26)
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const ascii = (/** @type {number} */ offset, /** @type {number} */ length) => String.fromCharCode(...head.subarray(offset, offset + length))
  if (head.length >= 24 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') return { width: view.getUint32(16), height: view.getUint32(20) }
  if (head.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  if (head.length >= 26 && ascii(0, 2) === 'BM') return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) }
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return null
  let offset = 2
  // A bound on the walk, far past the few dozen segments a camera or an editor writes.
  for (let steps = 0; steps < 10_000; steps++) {
    const segment = await read(offset, 9)
    if (segment.length < 4 || segment[0] !== 0xff) return null
    const marker = segment[1]
    // Fill before a marker.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    const header = new DataView(segment.buffer, segment.byteOffset, segment.byteLength)
    // A start-of-frame marker, baseline to lossless, holds the size; DHT, JPG and DAC do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return segment.length < 9 ? null : { width: header.getUint16(7), height: header.getUint16(5) }
    }
    offset += 2 + header.getUint16(2)
  }
  return null
}

/** @template F */
export class MediaStore {
  /**
   * @param {MediaAccess<F>} access where the files are, and where a download is kept
   * @param {{ fetch?: typeof fetch, idle?: number }} [options]
   *   `fetch`, for media named by web address; `idle`, the milliseconds a download may go without a byte
   */
  constructor(access, { fetch: fetchImpl = globalThis.fetch, idle = IDLE_MS } = {}) {
    this.access = access
    this.fetch = fetchImpl
    this.idle = idle
    /** @type {StagedFile<F>[]} */
    this.files = []
    /** @type {Map<string, { name: string, mime: string, width?: number, height?: number }>} by source, so one file named twice is copied once */
    this.known = new Map()
    /** @type {Set<string>} */
    this.names = new Set()
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
      const short = YOUTUBE_SHORT.exec(source)
      const address = short ? `https://www.youtube.com/watch?v=${short[1]}` : source
      const hosted = HOSTED.find(({ plays }) => plays.test(address))
      if (hosted) return { path: address, mime: hosted.mime, copyright }
      const url = URL.canParse(address) ? new URL(address) : null
      const other = url ? HOSTED.find(({ on }) => on(url)) : undefined
      if (other) {
        report(`${at}.path`, `${source} is an address on ${other.host} that H5P.Video cannot play: give ${other.form}`)
        return { path: source, copyright }
      }
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !web) {
      report(`${at}.path`, `expected ${this.access.what} or an http(s) address`)
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
        const file = await this.access.open(staged.from)
        try {
          const size = await imageSize((offset, length) => file.read(offset, length))
          if (!size) report(`${at}.path`, `${source} is not a ${extension.toUpperCase()} image whose size can be read`)
          else Object.assign(described, size)
        } finally {
          await file.close()
        }
      }
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
    const name = this.access.name(source)
    const extension = extensionOf(name)
    if (!(extension in types)) {
      report(`${at}.path`, `${source}: this field takes ${Object.keys(types).map((each) => `.${each}`).join(', ')}`)
      return null
    }
    const found = await this.access.local(source)
    if ('missing' in found) {
      report(`${at}.path`, `${source}: ${found.missing}`)
      return null
    }
    return { from: found.file, extension, stem: name.slice(0, name.length - extension.length - 1) }
  }

  /**
   * A web address downloaded and kept, its type taken from its name or, failing that, from what
   * the server says it is.
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
    const controller = new AbortController()
    const failed = (/** @type {unknown} */ error) => {
      const cause = controller.signal.aborted ? controller.signal.reason : error
      report(`${at}.path`, `${source} could not be downloaded: ${cause instanceof Error ? cause.message : cause}`)
      return null
    }
    // Started again by every byte that arrives: a page's timers have no `refresh`.
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer
    const wait = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(new Error(`nothing arrived for ${this.idle / 1000} s`)), this.idle)
    }
    wait()
    try {
      let response
      try {
        response = await this.fetch(url.href, { redirect: 'follow', signal: controller.signal })
      } catch (error) {
        return failed(error)
      }
      wait()
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        report(`${at}.path`, `${source} answered ${response.status}${kind === 'video' ? '; for a video on YouTube, Vimeo, Panopto or Echo360 give its address there' : ''}`)
        return null
      }
      const named = extensionOf(lastSegment(new URL(response.url || url.href).pathname))
      const served = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      const extension = named in types ? named : Object.keys(types).find((each) => types[each] === served)
      if (!extension) {
        await response.body.cancel()
        report(`${at}.path`, `${source} is ${served || 'of an unknown type'}: this field takes ${Object.keys(types).map((each) => `.${each}`).join(', ')}`)
        return null
      }
      let received = 0
      const limited = response.body.pipeThrough(new TransformStream({
        transform(chunk, stream) {
          wait()
          received += chunk.length
          if (received > MAX_DOWNLOAD) stream.error(new Error(`larger than ${MAX_DOWNLOAD / 1024 ** 3} GB`))
          else stream.enqueue(chunk)
        }
      }))
      let from
      try {
        from = await this.access.keep(limited, extension)
      } catch (error) {
        return failed(error)
      }
      const last = lastSegment(decodeURIComponent(new URL(response.url || url.href).pathname))
      const stem = (named && last.endsWith(`.${named}`) && last !== `.${named}` ? last.slice(0, -named.length - 1) : last) || kind
      return { from, extension, stem }
    } finally {
      clearTimeout(timer)
    }
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
