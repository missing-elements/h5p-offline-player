/**
 * Content types for served entries. A zip carries no media type, so every response has to be
 * typed from the extension: browsers ignore a stylesheet that is not `text/css`, and Safari
 * refuses to play media served as `application/octet-stream`.
 */
const TYPES: Record<string, string> = {
  // Runtime
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',

  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',

  // Audio and video
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',

  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',

  // Documents
  pdf: 'application/pdf'
}

/** Extensions the runtime needs whole: these are always served inline, whatever their size. */
const TEXT_EXTENSIONS = new Set(['js', 'mjs', 'json', 'css', 'html', 'htm', 'txt', 'xml', 'csv', 'vtt', 'srt', 'svg'])

export function extensionOf(entryName: string): string {
  const base = entryName.slice(entryName.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function contentTypeOf(entryName: string): string {
  return TYPES[extensionOf(entryName)] ?? 'application/octet-stream'
}

/**
 * True for entries the H5P runtime parses rather than streams. They are never chunked: a
 * partially available script is worse than a slow one.
 */
export function isTextEntry(entryName: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(entryName))
}
