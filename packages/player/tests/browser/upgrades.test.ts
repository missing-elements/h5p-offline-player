import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement } from '../../src/h5p-offline-player'
import { FIXTURES, frameDocument, frameWindow, play } from './utils'

/**
 * Content written for an older minor than the one served. The library pack keeps one minor per
 * major, so a stripped export written before the pack's versions plays against newer code, and a
 * library's code assumes its `upgrades.js` steps have run on the parameters: the platforms run
 * them when they install a newer minor. The frame runs them before the runtime starts. The
 * fixture's steps append their version to the text they change, so the text says which ran.
 */
describe('content written for an older minor', () => {
  interface Instance {
    libraryInfo: { versionedName: string; versionedNameNoSpaces: string }
    child?: Instance
  }

  const playWith = (src: string) => play(src, { libraries: FIXTURES.upgradeLibraries })

  const text = (player: H5PPlayerElement, selector: string) => frameDocument(player).querySelector(selector)?.textContent
  const content = (player: H5PPlayerElement) =>
    (frameWindow(player) as unknown as { H5P: { instances: Instance[] } }).H5P.instances[0]
  const upgradeScriptsAskedFor = (player: H5PPlayerElement) =>
    frameWindow(player)
      .performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname.split('/').slice(-2).join('/'))
      .filter((path) => path.endsWith('/upgrades.js'))
      .sort()

  it('runs the steps between the version written and the one served, in order', async () => {
    const player = await playWith(FIXTURES.writtenFor10)

    expect(text(player, '.h5p-offline-test-message')).toBe('Written for 1.0 [1.1] [1.2]')
    // The version that ran, which is also the category every statement from it carries.
    expect(content(player).libraryInfo.versionedNameNoSpaces).toBe('H5P.OfflineTest-1.2')
    expect(upgradeScriptsAskedFor(player)).toEqual(['H5P.OfflineChild-1.1/upgrades.js', 'H5P.OfflineTest-1.2/upgrades.js'])
  })

  it('runs only the steps after the version written', async () => {
    const player = await playWith(FIXTURES.writtenFor11)
    expect(text(player, '.h5p-offline-test-message')).toBe('Written for 1.1 [1.2]')
  })

  it('upgrades sub-content too, and names it by the version that runs', async () => {
    const player = await playWith(FIXTURES.writtenFor10)

    expect(text(player, '.h5p-offline-child-text')).toBe('Child written for 1.0 [child 1.1]')
    expect(content(player).child?.libraryInfo.versionedName).toBe('H5P.OfflineChild 1.1')
  })

  it('asks for no upgrade script when the content names the versions served', async () => {
    const player = await playWith(FIXTURES.writtenFor12)

    expect(text(player, '.h5p-offline-test-message')).toBe('Written for 1.2')
    expect(text(player, '.h5p-offline-child-text')).toBe('Child written for 1.1')
    expect(upgradeScriptsAskedFor(player)).toEqual([])
  })

  it('plays the content as written when a step fails', async () => {
    const player = await playWith(FIXTURES.upgradeFails)

    expect(player.state).toBe('ready')
    // The child's step would have succeeded; nothing is half done.
    expect(text(player, '.h5p-offline-test-message')).toBe('Written for 1.0')
    expect(text(player, '.h5p-offline-child-text')).toBe('Child written for 1.0')
    expect(content(player).child?.libraryInfo.versionedName).toBe('H5P.OfflineChild 1.0')
  })

  it('names a main library whose minor is 0 in full', async () => {
    // h5p-standalone wrote "H5P.OfflineTest 1", which the core took for the folder
    // `H5P.OfflineTest-1.undefined`, and every statement's category with it.
    const player = await play(FIXTURES.basic)
    expect(content(player).libraryInfo.versionedNameNoSpaces).toBe('H5P.OfflineTest-1.0')
  })
})
