import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The library pack's bytes, which the player pins by hash, depend on nothing but its libraries. A
 * zip records a wall-clock time with no zone, and the pack was once written with a date built
 * from UTC fields: the pack built at UTC+2 said 02:00 and CI's said 00:00, so the first weekly
 * refresh after the split rewrote every archive with no library changed (#48, #51).
 *
 * Each time zone runs in a process of its own: whether setting `TZ` inside a running test worker
 * moves its clock is the engine's business, and a child process starts in the zone it is given.
 */

const librariesDir = resolve(import.meta.dirname, '../../../libraries')
const parts = pathToFileURL(resolve(librariesDir, 'scripts/parts.mjs')).href

// A pack of one library, written the way apps/demo/scripts/build-libraries.mjs writes the real
// one, split by the real `splitPack`; prints the bytes' hashes and the first entry's DOS time and date.
const build = `
import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js'
import { FIXED_DATE, splitPack } from ${JSON.stringify(parts)}

configure({ useWebWorkers: false })
const writer = new ZipWriter(new BlobWriter('application/zip'), { lastModDate: FIXED_DATE, extendedTimestamp: false })
await writer.add('h5p.json', new TextReader('{}'))
await writer.add('H5P.Tiny-1.0/library.json', new TextReader(JSON.stringify({ machineName: 'H5P.Tiny', majorVersion: 1, minorVersion: 0, patchVersion: 3 })))
await writer.add('H5P.Tiny-1.0/tiny.js', new TextReader('H5P.Tiny = function () {}'))
const pack = new Uint8Array(await (await writer.close()).arrayBuffer())

const out = await mkdtemp(join(tmpdir(), 'pack-bytes-'))
const [{ sha256 }] = await splitPack(pack, out)
const part = await readFile(join(out, 'H5P.Tiny-1.0.h5p'))
const header = new DataView(pack.buffer)
console.log(JSON.stringify({
  pack: createHash('sha256').update(pack).digest('hex'),
  part: createHash('sha256').update(part).digest('hex'),
  indexed: sha256,
  time: header.getUint16(10, true),
  date: header.getUint16(12, true)
}))
`

function buildIn(timeZone: string) {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', build], {
    cwd: librariesDir,
    env: { ...process.env, TZ: timeZone },
    encoding: 'utf8'
  })
  return JSON.parse(output.trim().split('\n').at(-1)!) as { pack: string; part: string; indexed: string; time: number; date: number }
}

describe('the library pack', () => {
  it('is the same bytes in every time zone', () => {
    const [utc, ...others] = ['UTC', 'Europe/Kyiv', 'America/Los_Angeles', 'Pacific/Kiritimati'].map(buildIn)
    for (const other of others) expect(other).toEqual(utc)
    expect(utc.part).toBe(utc.indexed)
  }, 30_000)

  it('records 2000-01-01 02:00, the time pack 1.0.0 shipped with', () => {
    // A different time rewrites every part and every hash the player pins, for no library's sake.
    const { time, date } = buildIn('UTC')
    expect(time).toBe(2 << 11)
    expect(date).toBe(((2000 - 1980) << 9) | (1 << 5) | 1)
  }, 30_000)
})
