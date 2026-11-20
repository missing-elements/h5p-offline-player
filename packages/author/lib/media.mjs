import { mp4Info } from '@missing-elements/h5p-normalize/mp4'
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

/** The containers a video and a recording come in, among H5P's types, and how to name them. */
const PLAYS = {
  video: { takes: ['mp4', 'webm', 'ogg'], what: 'an MP4, WebM or Ogg video' },
  audio: { takes: ['mp3', 'mp4', 'wav', 'ogg', 'webm'], what: 'an MP3, M4A, WAV, Ogg or WebM recording' }
}

/** Codecs of an mp4's picture that not every browser plays, by the name its index gives them. */
const NOT_EVERYWHERE = /** @type {Record<string, string>} */ ({ hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)' })

/** Whether a host name is one of these domains or under one. @param {string} host @param {string[]} domains */
const under = (host, domains) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`))

/**
 * Video a host plays itself, which H5P.Video embeds by address. H5P.Video chooses the player for
 * an address by its own pattern for each host, and gives one no pattern matches to its HTML5
 * player, which cannot play a page. So `plays` takes only addresses H5P.Video 1.6's pattern for
 * the host takes as well, and any other address on the host (`on`, told by its name, with no
 * pattern to backtrack through its labels) is refused, naming the form. `oembed` is where the
 * host says whether it has the video, for the two hosts that answer anyone (#218), and `answers`
 * what each status it answers there means, as seen on 2026-11-20: a problem (`gone`) or a note
 * (`closed`), each with the words for it. A status not listed says nothing.
 * @type {{ host: string, mime: string, plays: RegExp, on: (url: URL) => boolean, form: string, oembed?: (address: string) => string, answers?: Record<number, { gone?: string, closed?: string }> }[]}
 */
const HOSTED = [
  {
    host: 'Vimeo',
    mime: 'video/Vimeo',
    plays: /^https?:\/\/(?:[\w-]+\.)*vimeo\.com\/(?:channels\/[A-Za-z_]+\/|groups\/[A-Za-z_]+\/videos\/)?\d/,
    on: (url) => under(url.hostname, ['vimeo.com']),
    form: 'https://vimeo.com/ and the video\'s number',
    // Every form it plays, a channel's and a group's too, and an unlisted video's with its hash.
    oembed: (address) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(address)}`,
    // 404 for no such video, a private one, and an unlisted one asked of without the rest of its
    // link (Vimeo's help centre). A video behind a password or let to some sites only answers
    // 200, and a 403 is Vimeo refusing the asker's network, which says nothing of the video.
    answers: {
      404: { gone: 'has no video there that others can play: give https://vimeo.com/ and the number of a public video, or all of an unlisted video\'s link, which has more after the number' }
    }
  },
  {
    host: 'YouTube',
    mime: 'video/YouTube',
    plays: /^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|v\/)|youtu\.be\/)[\w-]{11}/i,
    on: (url) => under(url.hostname, ['youtube.com', 'youtube-nocookie.com', 'youtu.be']),
    form: 'https://www.youtube.com/watch?v= and the video\'s id',
    // Asked by its watch address: YouTube's oEmbed answers 404 for /embed/ and /v/ addresses of a
    // video it has (2026-11-20).
    oembed: (address) => {
      const id = YOUTUBE_ID.exec(address)?.[1]
      return id ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}` : ''
    },
    // Seen: 400 for an id it never had, 404 for a video taken down, 403 for a private one, and
    // 200 for one that asks a viewer's age. 401 was not seen: it is said to be a video whose
    // owner has turned embedding off.
    answers: {
      400: { gone: 'has no video there: give https://www.youtube.com/watch?v= and the id of a public or unlisted video' },
      404: { gone: 'has no video there any more: give https://www.youtube.com/watch?v= and the id of a public or unlisted video' },
      403: { closed: 'says the video is private: nobody but its owner can play it until it is made public or unlisted' },
      401: { closed: 'would not say the video may be embedded: its owner may have turned embedding off, so play it where it will be used' }
    }
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

/** A YouTube video's id, in an address H5P.Video plays. */
const YOUTUBE_ID = /(?:[?&]v=|\/embed\/|\/v\/|youtu\.be\/)([\w-]{11})/i

/** How long a host may take to say whether it has a video, before the build goes on without it. */
const ASK_MS = 10_000

/**
 * What YouTube and Vimeo send with an answer that is no video: the status's own words and nothing
 * else ("Bad Request", "Not Found", "Forbidden", Vimeo's "404 Not Found"). A box between the build
 * and the host, a sandbox's proxy or a school's filter, answers with a page of its own, and so does
 * Vimeo where it refuses the asker's network: none of those is the host speaking of the video.
 */
const OWN_WORDS = /^(?:\d{3} )?(?:Bad Request|Unauthorized|Forbidden|Not Found)$/i

/** A YouTube Short or live stream, by its video's id, which H5P.Video plays at the watch address. */
const YOUTUBE_SHORT = /^https?:\/\/(?:[\w-]+\.)*youtube\.com\/(?:shorts|live)\/([\w-]{11})(?![\w-])/i

/** The licences a file's copyright may name, as H5P lists them. */
const COPYRIGHT_LICENSES = ['U', 'CC BY', 'CC BY-SA', 'CC BY-ND', 'CC BY-NC', 'CC BY-NC-SA', 'CC BY-NC-ND', 'GNU GPL', 'PD', 'C']

/** The parts of a file's copyright a source writes, as H5P records them. */
const COPYRIGHT_FIELDS = ['license', 'author', 'title', 'year', 'source', 'version']

/** A file's copyright source as H5P's editor takes it, and a build: a web address. */
const COPYRIGHT_SOURCE = /^https?:\/\/.+/i

/**
 * A saved file's copyright as a source writes it (#236): its parts that hold text, and nothing
 * where that is the licence "U" alone, which a build gives a file with none. H5P's editor saves
 * every part, empty where nobody wrote it, and a build refuses an empty one. A part a build
 * refuses, a licence H5P does not list for a file or a source that is no web address, is left out,
 * and `left` is told; a licence goes with its version.
 * @param {unknown} copyright
 * @param {(key: 'license' | 'source', value: string) => void} [left]
 * @returns {Record<string, string> | undefined}
 * @internal
 */
export function writtenCopyright(copyright, left = () => {}) {
  if (!copyright || typeof copyright !== 'object' || Array.isArray(copyright)) return undefined
  const parts = Object.entries(copyright).filter(([key, value]) => COPYRIGHT_FIELDS.includes(key) && typeof value === 'string' && value.trim() !== '')
  const license = parts.find(([key]) => key === 'license')?.[1]
  const listed = license === undefined || COPYRIGHT_LICENSES.includes(license)
  if (!listed) left('license', license)
  const source = parts.find(([key]) => key === 'source')?.[1]
  if (source !== undefined && !COPYRIGHT_SOURCE.test(source)) left('source', source)
  const kept = Object.fromEntries(parts.filter(([key, value]) => key === 'source' ? COPYRIGHT_SOURCE.test(value) : listed || (key !== 'license' && key !== 'version')))
  return Object.entries(kept).some(([key, value]) => key !== 'license' || value !== 'U') ? kept : undefined
}

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
 *   open(file: F): Promise<{ size: number, read(offset: number, length: number): Promise<Uint8Array>, close(): Promise<void> }>
 * }} MediaAccess
 *   `what`, what a source's path names, for problems; `name`, the file's own name it names;
 *   `local`, that file, or why there is none; `keep`, a download's bytes kept; `open`, a kept
 *   file's length, and its bytes read from an offset, fewer at its end
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
 * A URL's path decoded, or as written where an escape in it is not one, `%zz`: a name to keep,
 * which nothing is gained by refusing.
 * @param {string} path
 */
function decoded(path) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
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

/**
 * Whether bytes start with an MPEG audio frame's header a decoder takes: the sync bits, then no
 * reserved version, layer, bit rate or sample rate.
 * @param {Uint8Array} head
 */
const mpegFrame = (head) => head.length >= 4 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x18) !== 0x08 &&
  (head[1] & 0x06) !== 0 && (head[2] & 0xf0) !== 0xf0 && (head[2] & 0x0c) !== 0x0c

/**
 * What a video's or a recording's first bytes say it is: its container, a web page, or none known.
 * An mp4 or an m4a starts with `ftyp`, WebM with EBML's mark, Ogg with `OggS`, WAV with RIFF's
 * `WAVE`, MP3 with an ID3 tag or a frame header; a page with `<`, in UTF-8 or, after its
 * byte-order mark, in UTF-16.
 * @param {Uint8Array} head the file's first 16 bytes, or all of a shorter one
 * @returns {'mp4' | 'webm' | 'ogg' | 'wav' | 'mp3' | 'page' | undefined}
 */
function containerOf(head) {
  const ascii = (/** @type {number} */ offset, /** @type {number} */ length) => String.fromCharCode(...head.subarray(offset, offset + length))
  if (ascii(4, 4) === 'ftyp') return 'mp4'
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav'
  if (ascii(0, 3) === 'ID3' || mpegFrame(head)) return 'mp3'
  const text = ascii(0, head.length)
  // UTF-16 read as its characters by leaving out the zero bytes, which only it has here.
  const page = /^(?:\xff\xfe|\xfe\xff)/.test(text) ? text.slice(2).replaceAll('\0', '') : text.replace(/^\xef\xbb\xbf/, '')
  return /^\s*</.test(page) ? 'page' : undefined
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
    /** @type {Map<string, { name: string, mime: string, width?: number, height?: number }>} by kind and source, so one file named twice for one kind is copied once */
    this.known = new Map()
    /** @type {Set<string>} */
    this.names = new Set()
    /** @type {Map<string, number>} a video's or a recording's length in seconds, by its path in the package, where its index gave one */
    this.lengths = new Map()
    /** @type {Map<string, Promise<number>>} what a host answered of a video, by the address asked, so one video named twice is asked of once */
    this.asked = new Map()
    /** Whether a host gave no answer at all: with no network, none is asked again in this build. */
    this.unanswered = false
  }

  /**
   * A video's or a recording's length in seconds, by its path in the package, where it was read.
   * @param {string} path
   */
  lengthOf(path) {
    return this.lengths.get(path)
  }

  /**
   * A written file made what H5P stores: `{ path, mime, width?, height?, copyright }`, its bytes
   * staged for the package. A picture's size is read from its bytes, and a video's or a
   * recording's container; an mp4's index too, for its length and what its tracks hold.
   * @param {any} field the image, video, audio or file field
   * @param {{ path: string, copyright?: any }} value as written
   * @param {string} at where it is written, for problems
   * @param {(path: string, message: string) => void} report
   * @param {(path: string, message: string) => void} [note] what is worth saying of a file and no reason not to build
   * @returns {Promise<Record<string, unknown>>}
   */
  async resolve(field, value, at, report, note = () => {}) {
    const kind = /** @type {'image' | 'video' | 'audio' | 'file'} */ (field.type)
    const source = value.path.trim()
    const copyright = this.copyright(value.copyright, `${at}.copyright`, report)
    const web = /^https?:\/\//i.test(source)
    if (web && kind === 'video') {
      const short = YOUTUBE_SHORT.exec(source)
      const address = short ? `https://www.youtube.com/watch?v=${short[1]}` : source
      const hosted = HOSTED.find(({ plays }) => plays.test(address))
      if (hosted) {
        await this.#there(hosted, address, source, `${at}.path`, report, note)
        return { path: address, mime: hosted.mime, copyright }
      }
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
    const key = `${kind} ${source}`
    let known = this.known.get(key)
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
      } else if (kind === 'video' || kind === 'audio') {
        const file = await this.access.open(staged.from)
        try {
          const length = await this.#played(file, kind, source, web, `${at}.path`, report, note)
          if (length) this.lengths.set(name, length)
        } finally {
          await file.close()
        }
      }
      this.files.push({ name, from: staged.from })
      this.known.set(key, described)
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
      if (!COPYRIGHT_FIELDS.includes(key)) {
        report(`${at}.${key}`, 'is not part of a copyright; write license, author, title, year, source or version')
        continue
      }
      if (typeof entry !== 'string' || !entry.trim()) {
        report(`${at}.${key}`, 'expected text')
        continue
      }
      if (key === 'license' && !COPYRIGHT_LICENSES.includes(entry)) report(`${at}.license`, `use one of ${COPYRIGHT_LICENSES.join(', ')}`)
      if (key === 'source' && !COPYRIGHT_SOURCE.test(entry)) report(`${at}.source`, 'expected an http(s) address')
      out[key] = key === 'license' || key === 'version' ? entry : escapeText(entry)
    }
    return out
  }

  /**
   * A video's or a recording's bytes held to what its field takes: its container, from its first
   * bytes, a problem where it is none of those; for an mp4, its index, a problem where there is
   * none to read, and a note for a file with no sound, no picture, or a picture not every browser
   * plays. A file whose index lists no track says nothing either way.
   * @param {{ size: number, read(offset: number, length: number): Promise<Uint8Array> }} file
   * @param {'video' | 'audio'} kind
   * @param {string} source as written
   * @param {boolean} web named by a web address
   * @param {string} at
   * @param {(path: string, message: string) => void} report
   * @param {(path: string, message: string) => void} note
   * @returns {Promise<number | undefined>} its length in seconds, where its index gives one
   */
  async #played(file, kind, source, web, at, report, note) {
    const { takes, what } = PLAYS[kind]
    // An mp4 by its index, as the normalizer reads one, after `ftyp` or an older file's `moov`,
    // `mdat`, `free` or `wide`; any other by its first bytes.
    const info = await mp4Info((offset, length) => file.read(offset, length), file.size)
    const container = info ? 'mp4' : containerOf(await file.read(0, 16))
    if (container === 'page') {
      report(at, `${source} is a web page, not ${kind === 'video' ? 'a video' : 'a recording'}${web ? ': give the address of the file itself' : ''}`)
      return undefined
    }
    if (!container || !takes.includes(container)) {
      report(at, `${source} is not ${what}: its first bytes are none of theirs`)
      return undefined
    }
    if (!info) {
      if (container === 'mp4') report(at, `${source} has no index (moov) a player can read: is the file whole?`)
      return undefined
    }
    const held = new Set(info.tracks.map((track) => track.kind))
    if (held.size && !held.has('audio')) note(at, `${source} has no sound`)
    if (held.size && kind === 'video' && !held.has('video')) note(at, `${source} has no picture`)
    const codecs = new Set(info.tracks.filter((track) => track.kind === 'video').map((track) => NOT_EVERYWHERE[track.codec]).filter(Boolean))
    for (const codec of codecs) note(at, `${source} is ${codec}, which not every browser plays; H.264 plays in all of them`)
    return info.duration
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
    if (!Object.hasOwn(types, extension)) {
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
   * Whether a host has a video, asked of its oEmbed endpoint where it has one (#218): an address
   * holds to its form only, so a made-up id built and showed a dead player. What an answer means
   * is the host's own list (`answers`): a video that is not there is a problem, and one nobody
   * else can play yet a note, since its owner can open it. Any other answer, one that is not the
   * host's own (`OWN_WORDS`), no network, or no answer in ten seconds says nothing either way,
   * and the build goes on without it.
   * @param {(typeof HOSTED)[number]} hosted
   * @param {string} address as H5P.Video will play it
   * @param {string} source as written
   * @param {string} at
   * @param {(path: string, message: string) => void} report
   * @param {(path: string, message: string) => void} note
   */
  async #there(hosted, address, source, at, report, note) {
    const ask = hosted.oembed?.(address)
    if (!ask || !hosted.answers) return
    let answer = this.asked.get(ask)
    if (!answer) {
      // One at a time, and a network that is not there costs its ten seconds once, not a video.
      if (this.unanswered) return
      answer = this.#ask(ask, hosted.answers)
      this.asked.set(ask, answer)
    }
    const status = await answer
    if (status === 0) this.unanswered = true
    const meaning = hosted.answers[status]
    if (meaning?.gone) report(at, `${source}: ${hosted.host} ${meaning.gone} (it answered ${status})`)
    else if (meaning?.closed) note(at, `${source}: ${hosted.host} ${meaning.closed} (it answered ${status})`)
  }

  /**
   * The status a host's oEmbed endpoint answers; 0 where it does not answer in time, and -1 where
   * a status that would say something of the video comes with other words than the host's own.
   * @param {string} url
   * @param {Record<number, unknown>} answers the statuses that mean something
   * @returns {Promise<number>}
   */
  async #ask(url, answers) {
    try {
      const response = await this.fetch(url, { signal: AbortSignal.timeout(ASK_MS) })
      if (!Object.hasOwn(answers, response.status)) {
        await response.body?.cancel().catch(() => {})
        return response.status
      }
      return OWN_WORDS.test((await response.text()).trim()) ? response.status : -1
    } catch {
      return 0
    }
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
      const extension = Object.hasOwn(types, named) ? named : Object.keys(types).find((each) => types[each] === served)
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
      const last = lastSegment(decoded(new URL(response.url || url.href).pathname))
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
