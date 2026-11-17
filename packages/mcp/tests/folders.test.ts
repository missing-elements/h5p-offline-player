import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultFolders, fileStem, rootFolders } from '../lib/folders.mjs'

describe('the folders a build may use', () => {
  it('are Desktop, Documents and Downloads where they exist, never the home folder whole', async () => {
    const home = await mkdtemp(join(tmpdir(), 'h5p-mcp-home-'))
    try {
      await mkdir(join(home, 'Desktop'))
      await mkdir(join(home, 'Downloads'))
      expect(await defaultFolders(home)).toEqual([join(home, 'Desktop'), join(home, 'Downloads')])
    } finally {
      await rm(home, { recursive: true, force: true })
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
    expect(fileStem('?!')).toBe('h5p-content')
    expect(fileStem(undefined)).toBe('h5p-content')
  })
})
