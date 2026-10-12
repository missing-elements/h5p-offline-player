import { describe, expect, it } from 'vitest'
import { runSteps, upgradeContent, type UpgradeSource, type UpgradeTable } from '../src/content-upgrade'

/** A step that records its name in `params.log` and hands the parameters back. */
const step = (name: string) => (params: { log?: string[] }, finished: (error: unknown, params: unknown) => void) => {
  params.log = [...(params.log ?? []), name]
  finished(null, params)
}

/** What the player's file server would serve, by machine name, and the steps each served version has. */
function sourceOf(served: Record<string, string>, tables: Record<string, UpgradeTable> = {}) {
  const asked: string[] = []
  const source: UpgradeSource = {
    async served(machineName) {
      const version = served[machineName]
      if (!version) return null
      const [major, minor] = version.split('.').map(Number)
      return { major, minor, folder: `${machineName}-${version}` }
    },
    async steps(machineName, library) {
      asked.push(library.folder)
      return tables[machineName] ?? null
    }
  }
  return { source, asked }
}

describe('runSteps', () => {
  it('runs the steps after the version written up to the one served, lowest first', async () => {
    // "10" sorts before "2" as text; the steps are ordered as numbers.
    const table = { 1: { 1: step('1.1'), 2: step('1.2'), 3: step('1.3'), 10: step('1.10'), 11: step('1.11') } } as unknown as UpgradeTable
    const { params } = await runSteps(table, { major: 1, minor: 1 }, { major: 1, minor: 10 }, {}, undefined)
    expect(params).toEqual({ log: ['1.2', '1.3', '1.10'] })
  })

  it('takes no step of another major', async () => {
    const table = { 1: { 1: step('1.1') }, 2: { 1: step('2.1') } } as unknown as UpgradeTable
    const { params } = await runSteps(table, { major: 1, minor: 0 }, { major: 1, minor: 2 }, {}, undefined)
    expect(params).toEqual({ log: ['1.1'] })
  })

  it('accepts a step in the object form some libraries write', async () => {
    const table = { 1: { 1: { contentUpgrade: step('wrapped') } } } as unknown as UpgradeTable
    const { params } = await runSteps(table, { major: 1, minor: 0 }, { major: 1, minor: 1 }, {}, undefined)
    expect(params).toEqual({ log: ['wrapped'] })
  })

  it('hands each step the metadata, and keeps what a step hands back', async () => {
    const seen: unknown[] = []
    const table = {
      1: {
        1: (params: unknown, finished: (...args: unknown[]) => void, extras: { metadata?: { title?: string } }) => {
          seen.push(extras.metadata)
          finished(null, params, { metadata: { ...extras.metadata, title: 'Renamed' } })
        },
        2: (params: unknown, finished: (...args: unknown[]) => void, extras: { metadata?: unknown }) => {
          seen.push(extras.metadata)
          finished(null, params)
        }
      }
    } as unknown as UpgradeTable
    const { metadata } = await runSteps(table, { major: 1, minor: 0 }, { major: 1, minor: 2 }, {}, { title: 'Original', license: 'U' })
    expect(seen).toEqual([{ title: 'Original', license: 'U' }, { title: 'Renamed', license: 'U' }])
    expect(metadata).toEqual({ title: 'Renamed', license: 'U' })
  })

  it('waits for a step that calls back later', async () => {
    const table = {
      1: { 1: (params: object, finished: (...args: unknown[]) => void) => setTimeout(() => finished(null, { ...params, late: true }), 5) }
    } as unknown as UpgradeTable
    const { params } = await runSteps(table, { major: 1, minor: 0 }, { major: 1, minor: 1 }, {}, undefined)
    expect(params).toEqual({ late: true })
  })

  it('takes the first answer of a step that calls back twice', async () => {
    const table = {
      1: { 1: (_params: unknown, finished: (...args: unknown[]) => void) => { finished(null, { first: true }); finished(null, { second: true }) } }
    } as unknown as UpgradeTable
    const { params } = await runSteps(table, { major: 1, minor: 0 }, { major: 1, minor: 1 }, {}, undefined)
    expect(params).toEqual({ first: true })
  })

  it.each([
    ['an error handed to the callback', (_p: unknown, finished: (...args: unknown[]) => void) => finished('broken'), /broken/],
    ['a throw', () => { throw new Error('thrown') }, /thrown/],
    ['no parameters handed back', (_p: unknown, finished: (...args: unknown[]) => void) => finished(null), /returned no parameters/],
    ['no callback at all', () => {}, /did not finish in 20 ms/],
    ['a step that is not a function', 'not a step', /is not a function/]
  ])('fails on %s', async (_case, entry, message) => {
    const table = { 1: { 1: entry } } as unknown as UpgradeTable
    await expect(runSteps(table, { major: 1, minor: 0 }, { major: 1, minor: 1 }, {}, undefined, 20)).rejects.toThrow(message)
  })
})

describe('upgradeContent', () => {
  it('upgrades the main content to the version served, and names that version', async () => {
    const { source } = sourceOf({ 'H5P.Main': '1.2' }, { 'H5P.Main': { 1: { 1: step('1.1'), 2: step('1.2') } } as unknown as UpgradeTable })
    const result = await upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, {}, undefined, source)
    expect(result).toEqual({ params: { log: ['1.1', '1.2'] }, metadata: undefined, library: 'H5P.Main 1.2', changed: true })
  })

  it('upgrades sub-content wherever it sits, and renames it to the version served', async () => {
    const { source } = sourceOf(
      { 'H5P.Main': '1.0', 'H5P.Child': '1.1' },
      { 'H5P.Child': { 1: { 1: step('child 1.1') } } as unknown as UpgradeTable }
    )
    const params = {
      questions: [{ library: 'H5P.Child 1.0', params: {}, subContentId: 'a' }],
      group: { deeper: { library: 'H5P.Child 1.0', params: {}, subContentId: 'b', metadata: { title: 'B' } } }
    }
    const result = await upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, params, undefined, source)
    expect(result.changed).toBe(true)
    expect(result.params).toEqual({
      questions: [{ library: 'H5P.Child 1.1', params: { log: ['child 1.1'] }, subContentId: 'a' }],
      group: { deeper: { library: 'H5P.Child 1.1', params: { log: ['child 1.1'] }, subContentId: 'b', metadata: { title: 'B' } } }
    })
  })

  it('upgrades sub-content that a parent step put there', async () => {
    const parent = (params: Record<string, unknown>, finished: (...args: unknown[]) => void) =>
      finished(null, { ...params, created: { library: 'H5P.Child 1.0', params: {} } })
    const { source } = sourceOf(
      { 'H5P.Main': '1.1', 'H5P.Child': '1.1' },
      { 'H5P.Main': { 1: { 1: parent } } as unknown as UpgradeTable, 'H5P.Child': { 1: { 1: step('child 1.1') } } as unknown as UpgradeTable }
    )
    const result = await upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, {}, undefined, source)
    expect(result.params).toEqual({ created: { library: 'H5P.Child 1.1', params: { log: ['child 1.1'] } } })
  })

  it('leaves content served at the version it was written for alone, and asks for no steps', async () => {
    const { source, asked } = sourceOf({ 'H5P.Main': '1.0', 'H5P.Child': '1.0' })
    const params = { child: { library: 'H5P.Child 1.0', params: { text: 'x' } } }
    const result = await upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, params, undefined, source)
    expect(result).toEqual({ params: { child: { library: 'H5P.Child 1.0', params: { text: 'x' } } }, metadata: undefined, library: 'H5P.Main 1.0', changed: false })
    expect(asked).toEqual([])
  })

  it('leaves alone a library that is not served, or served at a lower minor or another major', async () => {
    const { source, asked } = sourceOf({ 'H5P.Main': '1.0', 'H5P.Lower': '1.1', 'H5P.Major': '2.0' })
    const params = {
      a: { library: 'H5P.Missing 1.0', params: {} },
      b: { library: 'H5P.Lower 1.3', params: {} },
      c: { library: 'H5P.Major 1.4', params: {} }
    }
    const result = await upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, params, undefined, source)
    expect(result.changed).toBe(false)
    expect(result.params).toEqual(params)
    expect(asked).toEqual([])
  })

  it('renames sub-content whose newer version has no steps, and changes nothing else', async () => {
    const { source, asked } = sourceOf({ 'H5P.Main': '1.0', 'H5P.Text': '1.1' })
    const result = await upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, { text: { library: 'H5P.Text 1.0', params: { text: 'x' } } }, undefined, source)
    expect(result).toMatchObject({ params: { text: { library: 'H5P.Text 1.1', params: { text: 'x' } } }, changed: true })
    expect(asked).toEqual(['H5P.Text-1.1'])
  })

  it('takes nothing for sub-content that is not shaped like it', async () => {
    const { source, asked } = sourceOf({ 'H5P.Main': '1.0', 'H5P.Child': '1.1' })
    const params = { a: { library: 'H5P.Child', params: {} }, b: { library: 'H5P.Child 1.0' }, c: { library: 'H5P.Child 1.0', params: 'text' } }
    const result = await upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, params, undefined, source)
    expect(result.changed).toBe(false)
    expect(asked).toEqual([])
  })

  it('fails when a library lookup cannot be answered, rather than taking it for not served', async () => {
    const source: UpgradeSource = {
      served: async (machineName) => { if (machineName === 'H5P.Child') throw new Error('timed out'); return { major: 1, minor: 0, folder: 'H5P.Main-1.0' } },
      steps: async () => null
    }
    await expect(
      upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, { child: { library: 'H5P.Child 1.0', params: {} } }, undefined, source)
    ).rejects.toThrow('timed out')
  })

  it('fails as a whole when one step fails, so the caller can play the content as written', async () => {
    const { source } = sourceOf(
      { 'H5P.Main': '1.1', 'H5P.Child': '1.1' },
      {
        'H5P.Main': { 1: { 1: step('main 1.1') } } as unknown as UpgradeTable,
        'H5P.Child': { 1: { 1: () => { throw new Error('child step broke') } } } as unknown as UpgradeTable
      }
    )
    await expect(
      upgradeContent({ machineName: 'H5P.Main', version: { major: 1, minor: 0 } }, { child: { library: 'H5P.Child 1.0', params: {} } }, undefined, source)
    ).rejects.toThrow('child step broke')
  })
})
