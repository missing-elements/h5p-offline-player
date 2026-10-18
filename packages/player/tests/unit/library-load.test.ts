import { describe, expect, it } from 'vitest'
import { filesIn, libraryLoad, loadOrder, toposort, walkLibraries, type LibraryLookup } from '../../src/sw/library-load'
import type { LibraryDependency } from '../../src/sw/package-reader'

/**
 * The order the frame loads libraries in has to be h5p-standalone's, which every content type has
 * been played in here. So h5p-standalone's own algorithm is kept below as the oracle: its
 * `loadDependencies` and `sortDependencies` from `src/h5p-standalone.ts` at v3.8.2, with the
 * `toposort` 2.0.2 it bundles (Marcel Klehr, MIT), each as it was written but for types.
 */
function referenceToposort(edges: Array<Array<string | undefined>>): Array<string | undefined> {
  const nodes = Array.from(new Set(edges.flatMap((edge) => [edge[0], edge[1]])))
  let cursor = nodes.length
  const sorted = new Array<string | undefined>(cursor)
  const visited: Record<number, boolean> = {}
  let i = cursor
  const outgoingEdges = new Map<string | undefined, Set<string | undefined>>()
  for (const edge of edges) {
    if (!outgoingEdges.has(edge[0])) outgoingEdges.set(edge[0], new Set())
    if (!outgoingEdges.has(edge[1])) outgoingEdges.set(edge[1], new Set())
    outgoingEdges.get(edge[0])!.add(edge[1])
  }
  const nodesHash = new Map(nodes.map((node, index) => [node, index]))
  const visit = (node: string | undefined, index: number, predecessors: Set<string | undefined>) => {
    if (predecessors.has(node)) throw new Error('Cyclic dependency')
    if (visited[index]) return
    visited[index] = true
    const outgoing = Array.from(outgoingEdges.get(node) || new Set<string | undefined>())
    let n = outgoing.length
    if (n) {
      predecessors.add(node)
      do {
        const child = outgoing[--n]
        visit(child, nodesHash.get(child)!, predecessors)
      } while (n)
      predecessors.delete(node)
    }
    sorted[--cursor] = node
  }
  while (i--) if (!visited[i]) visit(nodes[i], i, new Set())
  return sorted
}

interface Fake {
  folder: string
  dependencies: string[]
  js: string[]
  css: string[]
}

function referenceOrder(roots: string[], libraries: Map<string, Fake>): { scripts: string[]; styles: string[] } {
  // loadDependencies: a level at a time, duplicates in a level and all.
  const dependencies: Fake[] = []
  let toFind = roots
  while (toFind.length > 0) {
    const discovered = toFind.map((folder) => libraries.get(folder)!)
    const findNext: string[] = []
    for (const library of discovered) {
      dependencies.push(library)
      for (const dependency of library.dependencies) {
        const found = dependencies.find((each) => each.folder === dependency)
        const inLevel = discovered.find((each) => each.folder === dependency)
        if (!found && !inLevel) findNext.push(dependency)
      }
    }
    toFind = findNext
  }
  // sortDependencies.
  const graph: Array<Array<string | undefined>> = []
  const css: Record<string, string[]> = {}
  const js: Record<string, string[]> = {}
  for (const dependency of dependencies) {
    if (dependency.dependencies.length === 0) graph.push([dependency.folder])
    for (const node of dependency.dependencies) graph.push([dependency.folder, node])
    css[dependency.folder] = dependency.css.map((path) => `${dependency.folder}/${path}`)
    js[dependency.folder] = dependency.js.map((path) => `${dependency.folder}/${path}`)
  }
  const styles: string[] = []
  const scripts: string[] = []
  for (const name of referenceToposort(graph).reverse()) {
    if (name === undefined) continue
    styles.push(...css[name])
    scripts.push(...js[name])
  }
  return { scripts, styles }
}

/** A small, seeded generator, so a failure names a graph that can be played again. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

const dependencyOf = (folder: string): LibraryDependency => {
  const [, machineName, major, minor] = /^(.+)-(\d+)\.(\d+)$/.exec(folder)!
  return { machineName, majorVersion: Number(major), minorVersion: Number(minor) }
}

/** The walk's view of the fakes: each answered from its own folder. */
const lookupIn =
  (libraries: Map<string, Fake>): LibraryLookup =>
  async (dependency) => {
    const folder = `${dependency.machineName}-${dependency.majorVersion}.${dependency.minorVersion}`
    const library = libraries.get(folder)
    if (!library) return null
    return {
      folder,
      library: {
        machineName: dependency.machineName,
        majorVersion: dependency.majorVersion,
        minorVersion: dependency.minorVersion,
        preloadedDependencies: library.dependencies.map(dependencyOf),
        preloadedJs: library.js.map((path) => ({ path })),
        preloadedCss: library.css.map((path) => ({ path }))
      }
    }
  }

describe('the order the frame loads libraries in', () => {
  it("is h5p-standalone's, on five hundred dependency graphs", async () => {
    for (let seed = 1; seed <= 500; seed++) {
      const next = random(seed)
      const count = 1 + Math.floor(next() * 14)
      const folders = Array.from({ length: count }, (_, index) => `H5P.L${index}-1.${Math.floor(next() * 3)}`)
      const libraries = new Map<string, Fake>()
      folders.forEach((folder, index) => {
        // Each depends only on libraries after it, so the graph has no cycle, in a random order.
        const later = folders.slice(index + 1).filter(() => next() < 0.35)
        later.sort(() => next() - 0.5)
        const js = next() < 0.85 ? ['a.js', ...(next() < 0.3 ? ['b.js'] : [])] : []
        const css = next() < 0.6 ? ['a.css'] : []
        libraries.set(folder, { folder, dependencies: later, js, css })
      })
      const roots = folders.filter((_, index) => index === 0 || next() < 0.3)
      roots.sort(() => next() - 0.5)

      const walk = await walkLibraries(roots.map(dependencyOf), lookupIn(libraries))
      expect(loadOrder(walk.libraries, walk.folderOf), `seed ${seed}`).toEqual(referenceOrder(roots, libraries))
    }
  })

  it('loads a library once when two versions ask for the folder that serves both', async () => {
    // Content written for Text 1.0 and a library asking for 1.1, where 1.1 is what is served:
    // h5p-standalone named both folders and loaded the file twice.
    const lookup: LibraryLookup = async ({ machineName, majorVersion, minorVersion }) => {
      if (machineName === 'H5P.Text') return { folder: 'H5P.Text-1.1', library: { machineName, majorVersion: 1, minorVersion: 1, preloadedJs: [{ path: 'text.js' }] } }
      return {
        folder: `${machineName}-${majorVersion}.${minorVersion}`,
        library: { machineName, majorVersion, minorVersion, preloadedDependencies: [{ machineName: 'H5P.Text', majorVersion: 1, minorVersion: 1 }], preloadedJs: [{ path: 'set.js' }] }
      }
    }
    const walk = await walkLibraries(
      [
        { machineName: 'H5P.Set', majorVersion: 1, minorVersion: 0 },
        { machineName: 'H5P.Text', majorVersion: 1, minorVersion: 0 }
      ],
      lookup
    )
    expect(walk.libraries.map((library) => library.folder)).toEqual(['H5P.Set-1.0', 'H5P.Text-1.1'])
    expect(loadOrder(walk.libraries, walk.folderOf).scripts).toEqual(['H5P.Text-1.1/text.js', 'H5P.Set-1.0/set.js'])
  })

  it('breaks a dependency cycle where it closes, where h5p-standalone threw', async () => {
    const libraries = new Map<string, Fake>([
      ['H5P.A-1.0', { folder: 'H5P.A-1.0', dependencies: ['H5P.B-1.0'], js: ['a.js'], css: [] }],
      ['H5P.B-1.0', { folder: 'H5P.B-1.0', dependencies: ['H5P.A-1.0'], js: ['b.js'], css: [] }]
    ])
    expect(() => referenceOrder(['H5P.A-1.0'], libraries)).toThrow('Cyclic dependency')
    const walk = await walkLibraries([dependencyOf('H5P.A-1.0')], lookupIn(libraries))
    // The sort enters at B, the last node first seen, and reaches A, whose edge back to B closes
    // the cycle and is passed over: A counts as B's dependency, and loads first.
    expect(loadOrder(walk.libraries, walk.folderOf).scripts).toEqual(['H5P.A-1.0/a.js', 'H5P.B-1.0/b.js'])
  })

  it('names what nothing answers for, and does not walk below it', async () => {
    const libraries = new Map<string, Fake>([['H5P.A-1.0', { folder: 'H5P.A-1.0', dependencies: ['H5P.Gone-2.3'], js: ['a.js'], css: [] }]])
    const walk = await walkLibraries([dependencyOf('H5P.A-1.0')], lookupIn(libraries))
    expect(walk.missing).toEqual(['H5P.Gone-2.3'])
    expect(walk.libraries.map((library) => library.folder)).toEqual(['H5P.A-1.0'])
  })
})

describe('the sort', () => {
  it('puts every node before the nodes its edges point at', () => {
    expect(toposort([['a', 'b'], ['b', 'c'], ['a', 'c']])).toEqual(['a', 'b', 'c'])
  })
})

describe("a library's files", () => {
  it('are named under its folder, in the order its library.json gives', () => {
    expect(filesIn('H5P.A-1.0', [{ path: 'js/a.js' }, { path: 'dist/b.js' }])).toEqual(['H5P.A-1.0/js/a.js', 'H5P.A-1.0/dist/b.js'])
  })

  it('leave out a path that would leave the folder, and anything that is not one', () => {
    const paths = ['../other/x.js', 'js/../../x.js', '/x.js', '\\\\x.js', 'https://cdn.example/x.js', 'c:x.js', '..\\\\x.js', '', 7, null]
    expect(filesIn('H5P.A-1.0', paths.map((path) => ({ path })))).toEqual([])
    expect(filesIn('H5P.A-1.0', 'js/a.js')).toEqual([])
  })
})

describe('what the frame is told to load', () => {
  const walk = (folder: string, majorVersion = 1, minorVersion = 2) =>
    walkLibraries([{ machineName: 'H5P.Main', majorVersion: 1, minorVersion: 0 }], async () => ({
      folder,
      library: { machineName: 'H5P.Main', majorVersion, minorVersion, preloadedJs: [{ path: 'main.js' }] }
    }))
  const manifest = { mainLibrary: 'H5P.Main', preloadedDependencies: [{ machineName: 'H5P.Main', majorVersion: 1, minorVersion: 0 }] }

  it('names the main library at the version served, in full', async () => {
    const load = libraryLoad(manifest, await walk('H5P.Main-1.2'))
    expect(load).toEqual({ library: 'H5P.Main 1.2', scripts: ['H5P.Main-1.2/main.js'], styles: [], directories: {} })
    // A minor of 0 is written, where h5p-standalone left it out and the core read the folder as
    // `H5P.Main-1.undefined`.
    expect(libraryLoad(manifest, await walk('H5P.Main-1.0', 1, 0))?.library).toBe('H5P.Main 1.0')
  })

  it("tells the core where a library is that a folder's name does not say", async () => {
    // An older package keeps a library in a folder named without its version; the core's
    // `H5P.getLibraryPath` builds the name with one.
    expect(libraryLoad(manifest, await walk('H5P.Main'))?.directories).toEqual({ 'H5P.Main-1.2': 'H5P.Main' })
  })

  it('is nothing when the main library is not among the dependencies', async () => {
    expect(libraryLoad({ ...manifest, mainLibrary: 'H5P.Other' }, await walk('H5P.Main-1.2'))).toBeNull()
  })
})
