import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { crc32 as native } from '../lib/crc32.mjs'
import { crc32 as table } from '../lib/crc32-table.mjs'

const bytes = new Uint8Array(100_000).map((_, index) => (index * 7919) & 0xff)

describe('crc32', () => {
  it('by the table a page takes, is what zlib gives, continued across chunks too', () => {
    // The check value every CRC-32 implementation is held to.
    expect(table(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(table(new Uint8Array())).toBe(0)
    expect(table(bytes)).toBe(native(bytes))
    expect(table(bytes.subarray(40_000), table(bytes.subarray(0, 40_000)))).toBe(native(bytes))
    expect(native(bytes.subarray(40_000), native(bytes.subarray(0, 40_000)))).toBe(native(bytes))
  })

  it('is zlib\'s for Node by the package\'s name, and the table for anything else', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', "console.log(import.meta.resolve('@missing-elements/h5p-normalize/crc32'))"], { cwd: resolve(import.meta.dirname, '..') })
    expect(stdout.trim()).toMatch(/\/lib\/crc32\.mjs$/)
    const { exports } = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'))
    expect(exports['./crc32'].default).toBe('./lib/crc32-table.mjs')
  })
})
