import { describe, expect, it } from 'vitest'
import { LOCAL_HEADER_FIXED_SIZE, LOCAL_HEADER_SIGNATURE, localHeaderDataStart } from '../../src/shared/local-header'

/** A local header with the given name and extra lengths, as a zip writer lays it out. */
function header(nameLength: number, extraLength: number, signature = LOCAL_HEADER_SIGNATURE): Uint8Array {
  const bytes = new Uint8Array(LOCAL_HEADER_FIXED_SIZE)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, signature, true)
  view.setUint16(26, nameLength, true)
  view.setUint16(28, extraLength, true)
  return bytes
}

describe('localHeaderDataStart', () => {
  it('steps over the fixed part, the name and the extra field', () => {
    expect(localHeaderDataStart(1000, header(12, 0))).toBe(1000 + 30 + 12)
    expect(localHeaderDataStart(1000, header(12, 28))).toBe(1000 + 30 + 12 + 28)
  })

  it('takes the lengths from the header it is given, wherever the view sits in its buffer', () => {
    const padded = new Uint8Array(40)
    padded.set(header(5, 3), 10)
    expect(localHeaderDataStart(0, padded.subarray(10))).toBe(38)
  })

  it('refuses bytes that are not a local header', () => {
    expect(localHeaderDataStart(0, header(1, 1, 0x02014b50))).toBeNull()
    expect(localHeaderDataStart(0, new Uint8Array(12))).toBeNull()
  })
})
