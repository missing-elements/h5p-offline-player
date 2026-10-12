import { describe, expect, it } from 'vitest'
import { BlobWriter, TextReader, ZipWriter, configure } from '@zip.js/zip.js'
import { PackageReader, addonPatterns, librariesNamedIn, textMatches } from '../../src/sw/package-reader'
import type { SourceHandle } from '../../src/shared/source'

configure({ useWebWorkers: false })

/**
 * What the runtime is told to load when a bundle fills in for a stripped export. The export's
 * `h5p.json` names only the main library; the libraries its sub-content uses are named in
 * `content.json`, and the bundle — the app's pack in particular — may carry a newer minor.
 */

async function zipOf(files: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const [name, content] of Object.entries(files)) await writer.add(name, new TextReader(content))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

function handleOf(bytes: Uint8Array<ArrayBuffer>): SourceHandle {
  return {
    descriptor: { type: 'file', name: 'a.h5p', size: bytes.length, lastModified: 0 },
    size: bytes.length,
    async read(range) {
      return bytes.subarray(range.start, range.end + 1)
    },
    async stream(range) {
      return new Blob([bytes.subarray(range.start, range.end + 1)]).stream()
    }
  }
}

const library = (machineName: string, major: number, minor: number) =>
  JSON.stringify({ machineName, majorVersion: major, minorVersion: minor, patchVersion: 0, runnable: 1 })

/** A Question Set exported the way h5p.org does it: content only, one dependency listed. */
const stripped = {
  'h5p.json': JSON.stringify({
    title: 'Quiz',
    mainLibrary: 'H5P.QuestionSet',
    preloadedDependencies: [{ machineName: 'H5P.QuestionSet', majorVersion: '1', minorVersion: '20' }]
  }),
  'content/content.json': JSON.stringify({
    questions: [
      { library: 'H5P.MultiChoice 1.16', params: { answers: [] } },
      { library: 'H5P.TrueFalse 1.8', params: { media: { type: { library: 'H5P.Image 1.1' } } } },
      { library: 'H5P.MultiChoice 1.16', params: {} }
    ]
  })
}

/** A pack in the app's shape: an empty manifest, and the newest minor of each library. */
const pack = {
  'h5p.json': JSON.stringify({ title: 'pack', preloadedDependencies: [] }),
  'H5P.QuestionSet-1.21/library.json': library('H5P.QuestionSet', 1, 21),
  'H5P.MultiChoice-1.17/library.json': library('H5P.MultiChoice', 1, 17),
  'H5P.TrueFalse-1.8/library.json': library('H5P.TrueFalse', 1, 8),
  'H5P.Image-1.1/library.json': library('H5P.Image', 1, 1)
}

/** H5P.MathDisplay's `library.json` as h5p.org publishes 1.0.50: an addon for text with LaTeX in it. */
const mathDisplay = (minor: number) =>
  JSON.stringify({
    machineName: 'H5P.MathDisplay',
    majorVersion: 1,
    minorVersion: minor,
    patchVersion: 50,
    runnable: 0,
    addTo: { content: { types: [{ text: { regex: '/\\$\\$.+\\$\\$|\\\\\\[.+\\\\\\]|\\\\\\(.+\\\\\\)/' } }] } }
  })

async function withPack(content: Record<string, string>, bundle: Record<string, string> = pack) {
  const reader = await PackageReader.open('c', handleOf(await zipOf(content)), { requireLibraries: false })
  reader.use(await PackageReader.open('p', handleOf(await zipOf(bundle)), { requireLibraries: false }))
  return reader
}

describe('librariesNamedIn', () => {
  it('finds every sub-content library, however deep, each once, in the order met', () => {
    expect(librariesNamedIn(JSON.parse(stripped['content/content.json']))).toEqual([
      { machineName: 'H5P.MultiChoice', majorVersion: 1, minorVersion: 16 },
      { machineName: 'H5P.TrueFalse', majorVersion: 1, minorVersion: 8 },
      { machineName: 'H5P.Image', majorVersion: 1, minorVersion: 1 }
    ])
  })

  it('ignores what is not a library reference', () => {
    expect(
      librariesNamedIn({ library: 'H5P.MultiChoice', a: { library: 'x 1' }, b: { library: 42 }, c: 'H5P.Text 1.1' })
    ).toEqual([])
  })

  it('survives parameters nested past any real content', () => {
    let deep: Record<string, unknown> = { library: 'H5P.Deep 1.0' }
    for (let i = 0; i < 1000; i++) deep = { child: deep }
    expect(librariesNamedIn(deep)).toEqual([])
  })
})

describe('mergedManifest with the pack attached', () => {
  it('adds the libraries content.json names, so sub-content has its constructors', async () => {
    const merged = await (await withPack(stripped)).mergedManifest()
    expect(merged.preloadedDependencies?.map((dependency) => dependency.machineName)).toEqual([
      'H5P.QuestionSet',
      'H5P.MultiChoice',
      'H5P.TrueFalse',
      'H5P.Image'
    ])
  })

  it('keeps a dependency the pack carries only in a newer minor, as the content wrote it', async () => {
    const merged = await (await withPack(stripped)).mergedManifest()
    // 1.20 and 1.16, not the pack's 1.21 and 1.17: the file server maps the folder, and the
    // content's own version is what h5p-standalone asks for.
    expect(merged.preloadedDependencies?.[0]).toEqual({ machineName: 'H5P.QuestionSet', majorVersion: '1', minorVersion: '20' })
    expect(merged.preloadedDependencies?.[1]).toMatchObject({ machineName: 'H5P.MultiChoice', minorVersion: 16 })
  })

  it('leaves out a library nothing can supply, rather than name one the runtime cannot load', async () => {
    const content = {
      ...stripped,
      'content/content.json': JSON.stringify({ questions: [{ library: 'H5P.Unknown 1.0' }, { library: 'H5P.MultiChoice 2.0' }] })
    }
    const merged = await (await withPack(content)).mergedManifest()
    expect(merged.preloadedDependencies?.map((dependency) => dependency.machineName)).toEqual(['H5P.QuestionSet'])
  })

  it('does without content.json when it cannot be read', async () => {
    const merged = await (await withPack({ ...stripped, 'content/content.json': 'not json' })).mergedManifest()
    expect(merged.preloadedDependencies?.map((dependency) => dependency.machineName)).toEqual(['H5P.QuestionSet'])
  })

  it("adds the bundle's addon to content whose text it is for, its newest version, and to no other", async () => {
    const bundle = {
      ...pack,
      'H5P.MathDisplay-1.0/library.json': mathDisplay(0),
      'H5P.MathDisplay-1.1/library.json': mathDisplay(1)
    }
    const withFormula = {
      ...stripped,
      'content/content.json': JSON.stringify({ questions: [{ library: 'H5P.MultiChoice 1.16', params: { question: '<p>Solve \\(x^2 = 4\\)</p>' } }] })
    }
    const merged = await (await withPack(withFormula, bundle)).mergedManifest()
    expect(merged.preloadedDependencies?.at(-1)).toEqual({ machineName: 'H5P.MathDisplay', majorVersion: 1, minorVersion: 1 })

    const plain = await (await withPack(stripped, bundle)).mergedManifest()
    expect(plain.preloadedDependencies?.map((dependency) => dependency.machineName)).not.toContain('H5P.MathDisplay')
  })
})

describe('missingDependencies', () => {
  const needing = (machineName: string, major: number, minor: number, ...dependencies: Array<[string, number, number]>) =>
    JSON.stringify({
      machineName,
      majorVersion: major,
      minorVersion: minor,
      preloadedDependencies: dependencies.map(([name, majorVersion, minorVersion]) => ({ machineName: name, majorVersion, minorVersion }))
    })
  /** An old export: its manifest names Font Awesome 4.3, which it carries, and its library asks for 4.5. */
  const inconsistent = {
    'h5p.json': JSON.stringify({
      mainLibrary: 'H5P.Main',
      preloadedDependencies: [
        { machineName: 'H5P.Main', majorVersion: 1, minorVersion: 0 },
        { machineName: 'FontAwesome', majorVersion: 4, minorVersion: 3 }
      ]
    }),
    'content/content.json': '{}',
    'H5P.Main-1.0/library.json': needing('H5P.Main', 1, 0, ['FontAwesome', 4, 5], ['H5P.Helper', 1, 0]),
    'H5P.Helper-1.0/library.json': needing('H5P.Helper', 1, 0, ['H5P.Deep', 2, 0], ['H5P.Main', 1, 0]),
    'FontAwesome-4.3/library.json': library('FontAwesome', 4, 3)
  }
  const read = ({ reader, entry }: { reader: PackageReader; entry: Parameters<PackageReader['inflate']>[0] }) =>
    new Response(reader.inflate(entry)).json()

  it("follows each library's own dependencies, as the runtime does, and names what nothing provides", async () => {
    const reader = await PackageReader.open('c', handleOf(await zipOf(inconsistent)), { requireLibraries: false })
    // The top-level check passes: everything h5p.json names is there.
    expect(reader.missingLibraries()).toBeNull()
    expect(await reader.missingDependencies(reader.manifest, read)).toEqual({
      mainLibrary: 'H5P.Main',
      folders: ['FontAwesome-4.5', 'H5P.Deep-2.0'],
      all: false
    })
  })

  it('is satisfied by a bundle that has them, through the same version rule as the files', async () => {
    const bundle = {
      'h5p.json': '{}',
      'FontAwesome-4.6/library.json': library('FontAwesome', 4, 6),
      'H5P.Deep-2.0/library.json': library('H5P.Deep', 2, 0)
    }
    const reader = await withPack(inconsistent, bundle)
    expect(await reader.missingDependencies(await reader.mergedManifest(), read)).toBeNull()
  })
})

describe('addonPatterns and textMatches', () => {
  it("read MathDisplay's pattern as upstream matches it: $$…$$, \\[…\\] and \\(…\\)", () => {
    const patterns = addonPatterns(JSON.parse(mathDisplay(0)))
    expect(patterns).toHaveLength(1)
    for (const text of ['$$E = mc^2$$', 'a \\[x\\] b', 'inline \\(y\\)']) expect(textMatches({ text }, patterns), text).toBe(true)
    for (const text of ['$5 and $6', '\\(unclosed', 'no maths']) expect(textMatches({ text }, patterns), text).toBe(false)
    // In any string, at any depth, as `textAddonMatches` walks arrays and objects alike.
    expect(textMatches({ a: [{ b: { c: ['$$x$$'] } }] }, patterns)).toBe(true)
  })

  it('takes other delimiters and the flags JavaScript shares, and leaves out what it cannot read', () => {
    const typed = (...regexes: unknown[]) => ({ addTo: { content: { types: regexes.map((regex) => ({ text: { regex } })) } } })
    expect(addonPatterns(typed('#ab+c#i')).map(String)).toEqual(['/ab+c/i'])
    // `x` has no counterpart, a letter cannot delimit, `(?<` without a name is not JavaScript.
    expect(addonPatterns(typed('/a b/x', 'aba', '/(?<)/', '/', 42))).toEqual([])
    expect(addonPatterns({ addTo: 'content' })).toEqual([])
    expect(addonPatterns(null)).toEqual([])
  })

  it('survives parameters nested past any real content', () => {
    let deep: unknown = '$$x$$'
    for (let i = 0; i < 1000; i++) deep = { child: deep }
    expect(textMatches(deep, addonPatterns(JSON.parse(mathDisplay(0))))).toBe(false)
  })
})
