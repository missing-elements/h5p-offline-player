import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultFolders, fileStem, rootFolders } from '../lib/folders.mjs'

describe('the folders a build may use', () => {
  it('are Desktop, Documents and Downloads where they exist, never the home folder whole', async () => {
    const home = await mkdtemp(join(tmpdir(), 'h5p-mcp-home-'))
    const drive = await mkdtemp(join(tmpdir(), 'h5p-mcp-drive-'))
    try {
      await mkdir(join(home, 'Documents'))
      expect(await defaultFolders(home)).toEqual([join(home, 'Documents')])
      // A link to a folder elsewhere, as on another drive, is that folder; a link to the home
      // folder, or to one that holds it, would open the whole of it.
      await symlink(drive, join(home, 'Downloads'), 'junction')
      await symlink(home, join(home, 'Desktop'), 'junction')
      expect(await defaultFolders(home)).toEqual([join(home, 'Documents'), join(home, 'Downloads')])
      await rm(join(home, 'Desktop'))
      await symlink(dirname(home), join(home, 'Desktop'), 'junction')
      expect(await defaultFolders(home)).toEqual([join(home, 'Documents'), join(home, 'Downloads')])
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(drive, { recursive: true, force: true })
    }
  })

  it('are the app\'s roots that are folders on this computer', () => {
    const folder = join(tmpdir(), 'lesson')
    expect(rootFolders([{ uri: pathToFileURL(folder).href }, { uri: 'https://example.com/repo' }])).toEqual([folder])
  })
})

describe('a package\'s file name', () => {
  it('is its title\'s letters and digits, in any script', () => {
    expect(fileStem('Water cycle: 3 questions!')).toBe('water-cycle-3-questions')
    expect(fileStem('Мій тест')).toBe('мій-тест')
    expect(fileStem('Größe & Maß')).toBe('größe-maß')
  })

  it('is cut at 60 characters, and stands in for a title with none', () => {
    expect(fileStem('a'.repeat(40) + ' ' + 'b'.repeat(40))).toBe(`${'a'.repeat(40)}-${'b'.repeat(19)}`)
    // Characters, not halves of one: a letter outside the basic range is two.
    expect(fileStem(`a${'𠀀'.repeat(70)}`)).toBe(`a${'𠀀'.repeat(59)}`)
    expect(fileStem('?!')).toBe('h5p-content')
    expect(fileStem(undefined)).toBe('h5p-content')
  })

  it('is never a name Windows keeps for a device', () => {
    expect(fileStem('Con')).toBe('con-file')
    expect(fileStem('LPT1')).toBe('lpt1-file')
    expect(fileStem('Console')).toBe('console')
  })
})
