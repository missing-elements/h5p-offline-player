import { crc32, deflateSync } from 'node:zlib'

/** A PNG of one colour. */
export function png(width: number, height: number) {
  const row = Buffer.alloc(1 + width * 3, 0x80)
  row[0] = 0
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
    return Buffer.concat([length, Buffer.from(type), data, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}

/**
 * A JPEG's markers as far as its frame header, after `padding` bytes of APP2 segments, where a
 * colour profile goes: all the build reads of a picture. Nothing here decodes.
 */
export function jpeg(width: number, height: number, padding = 0) {
  const segments = [Buffer.from([0xff, 0xd8])]
  for (let left = padding; left > 0; left -= 65533) {
    const segment = Buffer.alloc(4 + Math.min(left, 65533))
    segment.writeUInt16BE(0xffe2)
    segment.writeUInt16BE(segment.length - 2, 2)
    segments.push(segment)
  }
  const frame = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
  frame.writeUInt16BE(height, 5)
  frame.writeUInt16BE(width, 7)
  return Buffer.concat([...segments, frame, Buffer.from([0xff, 0xd9])])
}

/** An mp4 as boxes, its index after its media unless `faststart`. */
export function mp4(faststart: boolean) {
  const box = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(8 + body.length)
    head.write(type, 4)
    return Buffer.concat([head, body])
  }
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomavc1'))
  const moov = box('moov', box('mvhd', Buffer.alloc(100)))
  const mdat = box('mdat', Buffer.alloc(4096, 7))
  return Buffer.concat(faststart ? [ftyp, moov, mdat] : [ftyp, mdat, moov])
}
