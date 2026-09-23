import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter, type FileEntry } from '@zip.js/zip.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeArchive, orderEntries, plainRelativeName, targetFormOf } from '../../scripts/lib/normalize.mjs'
import { atomsIn, sampleMp4 } from './helpers/mp4'

const text = (value: unknown) => new TextReader(JSON.stringify(value))
const noise = (length: number, seed: number) => new Uint8Array(length).map((_, index) => (index * seed + (index >> 3)) & 0xff)

const video = sampleMp4({ mdatSize: 5000 })
const png = noise(4000, 131)
const mp3 = noise(3000, 17)
const icon = noise(500, 7)
const script = 'export const answer = 42\n'.repeat(80)
/** A manifest of realistic size: a handful of bytes would not shrink under deflate, and would rightly be copied. */
const libraryJson = {
  title: 'Foo',
  machineName: 'H5P.Foo',
  majorVersion: 1,
  minorVersion: 0,
  patchVersion: 3,
  runnable: 1,
  preloadedJs: [{ path: 'foo.js' }],
  preloadedCss: [{ path: 'foo.css' }],
  description: 'A library that exists to be reordered. '.repeat(8)
}

/**
 * The shape a careless exporter produces: content first and libraries last, media deflated,
 * text stored, a directory entry, a hostile name and a duplicate.
 */
async function carelessArchive(): Promise<Uint8Array> {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  await writer.add('content/', undefined, { directory: true })
  await writer.add('content/content.json', text({ media: { path: 'videos/a.mp4' } }))
  await writer.add('content/videos/a.mp4', new Uint8ArrayReader(video.bytes))
  await writer.add('content/images/x.png', new Uint8ArrayReader(png))
  await writer.add('content/audio/b.mp3', new Uint8ArrayReader(mp3), { level: 0 })
  await writer.add('../evil.js', new TextReader('window.evil = true'))
  await writer.add('H5P.Foo-1.0/library.json', text(libraryJson), { level: 0 })
  await writer.add('H5P.Foo-1.0/foo.js', new TextReader(script), { level: 0 })
  await writer.add('H5P.Foo-1.0/icon.png', new Uint8ArrayReader(icon), { level: 0 })
  await writer.add('content/./content.json', new TextReader('{"shadow":true}'))
  await writer.add('h5p.json', text({ mainLibrary: 'H5P.Foo' }))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

async function entriesOf(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])))
  const entries = (await reader.getEntries()).filter((entry): entry is FileEntry => !entry.directory)
  const data = new Map<string, Uint8Array>()
  for (const entry of entries) data.set(entry.filename, await entry.getData(new Uint8ArrayWriter()))
  await reader.close()
  return { entries, data }
}

describe('normalizeArchive', () => {
  let dir: string
  let input: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'normalize-test-'))
    input = join(dir, 'careless.h5p')
    await writeFile(input, await carelessArchive())
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reorders, stores media, moves the mp4 index, deflates text and drops what the player would refuse', async () => {
    const output = join(dir, 'careless.normalized.h5p')
    const report = await normalizeArchive({ input, output })
    const { entries, data } = await entriesOf(output)

    expect(entries.map((entry) => entry.filename)).toEqual([
      'h5p.json',
      'H5P.Foo-1.0/library.json',
      'H5P.Foo-1.0/foo.js',
      'H5P.Foo-1.0/icon.png',
      'content/content.json',
      'content/videos/a.mp4',
      'content/images/x.png',
      'content/audio/b.mp3'
    ])
    const methods = Object.fromEntries(entries.map((entry) => [entry.filename, entry.compressionMethod]))
    expect(methods).toEqual({
      'h5p.json': 8,
      'H5P.Foo-1.0/library.json': 8,
      'H5P.Foo-1.0/foo.js': 8,
      'H5P.Foo-1.0/icon.png': 0,
      'content/content.json': 8,
      'content/videos/a.mp4': 0,
      'content/images/x.png': 0,
      'content/audio/b.mp3': 0
    })
    expect(entries.every((entry) => entry.bitFlag?.dataDescriptor === false)).toBe(true)

    // Content is byte-identical except the mp4, which is the same bytes in faststart order.
    expect(data.get('content/images/x.png')).toEqual(png)
    expect(data.get('content/audio/b.mp3')).toEqual(mp3)
    expect(data.get('H5P.Foo-1.0/icon.png')).toEqual(icon)
    expect(new TextDecoder().decode(data.get('H5P.Foo-1.0/foo.js'))).toBe(script)
    expect(JSON.parse(new TextDecoder().decode(data.get('content/content.json')))).toEqual({ media: { path: 'videos/a.mp4' } })
    const mp4 = data.get('content/videos/a.mp4')!
    expect(mp4.length).toBe(video.bytes.length)
    expect(atomsIn(mp4).map((atom) => atom.type)).toEqual(['ftyp', 'free', 'moov', 'mdat'])

    const actions = Object.fromEntries(report.entries.map((entry) => [entry.name, entry.action]))
    expect(actions).toEqual({
      'h5p.json': 'copy',
      'H5P.Foo-1.0/library.json': 'deflate',
      'H5P.Foo-1.0/foo.js': 'deflate',
      'H5P.Foo-1.0/icon.png': 'copy',
      'content/content.json': 'copy',
      'content/videos/a.mp4': 'faststart',
      'content/images/x.png': 'store',
      'content/audio/b.mp3': 'copy'
    })
    expect(report.entries.find((entry) => entry.name === 'content/videos/a.mp4')?.detail).toMatch(/moov was behind/)
    expect(report.dropped.directories).toBe(1)
    expect(report.dropped.rejected).toEqual([
      { name: '../evil.js', reason: 'not a plain relative path' },
      { name: 'content/./content.json', reason: 'duplicate of content/content.json' }
    ])
    expect(report.bytesOut).toBe((await stat(output)).size)
    expect(report.warnings).toEqual([])
  })

  it('reports the same plan on a dry run and writes nothing', async () => {
    const report = await normalizeArchive({ input })
    expect(report.bytesOut).toBeNull()
    expect(report.entries.map((entry) => [entry.name, entry.action])).toEqual([
      ['h5p.json', 'copy'],
      ['H5P.Foo-1.0/library.json', 'deflate'],
      ['H5P.Foo-1.0/foo.js', 'deflate'],
      ['H5P.Foo-1.0/icon.png', 'copy'],
      ['content/content.json', 'copy'],
      ['content/videos/a.mp4', 'faststart'],
      ['content/images/x.png', 'store'],
      ['content/audio/b.mp3', 'copy']
    ])
    expect(report.payloadOut).toBeGreaterThan(0)
    await expect(stat(join(dir, 'never-written.h5p'))).rejects.toThrow()
  })

  it('warns about an archive with no manifest', async () => {
    const path = join(dir, 'bundle.h5p')
    const writer = new ZipWriter(new BlobWriter('application/zip'))
    await writer.add('H5P.Foo-1.0/library.json', text({ machineName: 'H5P.Foo' }))
    await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
    const report = await normalizeArchive({ input: path })
    expect(report.warnings).toEqual(['no h5p.json at the root: this is not a content package'])
  })
})

describe('orderEntries', () => {
  const named = (...names: string[]) => names.map((name) => ({ name, target: targetFormOf(name) }))

  it('puts the manifest first, library folders whole, content media last', () => {
    const ordered = orderEntries(
      named(
        'content/images/a.png',
        'content/content.json',
        'H5P.B-1.0/b.js',
        'content/video.mp4',
        'H5P.A-1.0/a.js',
        'H5P.B-1.0/img/logo.png',
        'H5P.A-1.0/library.json',
        'README.txt',
        'h5p.json'
      )
    ).map((entry) => entry.name)
    expect(ordered).toEqual([
      'h5p.json',
      'README.txt',
      'H5P.B-1.0/b.js',
      'H5P.B-1.0/img/logo.png',
      'H5P.A-1.0/a.js',
      'H5P.A-1.0/library.json',
      'content/content.json',
      'content/images/a.png',
      'content/video.mp4'
    ])
  })
})

describe('targetFormOf', () => {
  it('stores media, compresses text, copies the rest', () => {
    expect(targetFormOf('content/videos/a.MP4')).toBe('store')
    expect(targetFormOf('content/images/a.jpeg')).toBe('store')
    expect(targetFormOf('H5P.Foo-1.0/fonts/f.woff2')).toBe('store')
    expect(targetFormOf('H5P.Foo-1.0/scripts/foo.js')).toBe('compress')
    expect(targetFormOf('content/content.json')).toBe('compress')
    expect(targetFormOf('content/thing.unknown')).toBe('copy')
    expect(targetFormOf('LICENSE')).toBe('copy')
  })
})

describe('plainRelativeName', () => {
  it('mirrors the player: canonical relative paths in, anything else rejected', () => {
    expect(plainRelativeName('content/content.json')).toBe('content/content.json')
    expect(plainRelativeName('./content//x.json')).toBe('content/x.json')
    expect(plainRelativeName('content\\windows.json')).toBe('content/windows.json')
    expect(plainRelativeName('../escaped.js')).toBeNull()
    expect(plainRelativeName('/abs.js')).toBeNull()
    expect(plainRelativeName('C:/x.js')).toBeNull()
    expect(plainRelativeName('a\u0000b')).toBeNull()
    expect(plainRelativeName('')).toBeNull()
  })
})
