/**
 * An mp4 as boxes, its index after its media unless `faststart`. With `seconds` its index says how
 * long it is, and with `tracks` what each track holds, by its handler and its codec, where a reader
 * looks for them; without, it says neither. Nothing here decodes, and nothing needs Node: the
 * page's build is given one too.
 */
export function mp4(faststart: boolean, { seconds, tracks = [] }: { seconds?: number, tracks?: [handler: string, codec: string][] } = {}) {
  const text = (value: string) => new TextEncoder().encode(value)
  const concat = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let at = 0
    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
  const box = (type: string, ...body: Uint8Array[]) => {
    const inner = concat(body)
    const out = new Uint8Array(8 + inner.length)
    new DataView(out.buffer).setUint32(0, out.length)
    out.set(text(type), 4)
    out.set(inner, 8)
    return out
  }
  const words = (...values: number[]) => {
    const out = new Uint8Array(values.length * 4)
    values.forEach((value, i) => new DataView(out.buffer).setUint32(i * 4, value))
    return out
  }
  const ftyp = box('ftyp', text('isom\0\0\0\0isomavc1'))
  // Version 0: flags, two times, the timescale and the duration, then the rest of the header.
  const mvhd = box('mvhd', seconds === undefined ? new Uint8Array(100) : concat([words(0, 0, 0, 1000, Math.round(seconds * 1000)), new Uint8Array(80)]))
  const trak = ([handler, codec]: [string, string]) => box('trak', box('mdia',
    box('hdlr', words(0, 0), text(handler), new Uint8Array(13)),
    box('minf', box('stbl', box('stsd', words(0, 1, 16), text(codec), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]))))))
  const moov = box('moov', mvhd, ...tracks.map(trak))
  const mdat = box('mdat', new Uint8Array(4096).fill(7))
  return concat(faststart ? [ftyp, moov, mdat] : [ftyp, mdat, moov])
}
