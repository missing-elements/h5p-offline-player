import { describe, expect, it } from 'vitest'
import { filePkgId, remotePkgId } from '../../src/shared/pkg-id'

describe('remotePkgId', () => {
  it('is stable for the same URL, so a cached package is found again', async () => {
    expect(await remotePkgId('https://host.example/course.h5p')).toBe(
      await remotePkgId('https://host.example/course.h5p')
    )
  })

  it('changes when the validator changes, so a republished archive gets fresh chunks', async () => {
    const before = await remotePkgId('https://host.example/course.h5p', '"v1"')
    const after = await remotePkgId('https://host.example/course.h5p', '"v2"')
    expect(before).not.toBe(after)
  })

  it('treats an absent validator as its own case', async () => {
    const withValidator = await remotePkgId('https://host.example/course.h5p', '"v1"')
    const without = await remotePkgId('https://host.example/course.h5p')
    expect(withValidator).not.toBe(without)
  })

  it('produces the 32 hex characters the routes match on', async () => {
    expect(await remotePkgId('https://host.example/course.h5p')).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('filePkgId', () => {
  const file = { name: 'course.h5p', size: 1024, lastModified: 1700000000000 }

  it('is stable for the same picked file', async () => {
    expect(await filePkgId(file)).toBe(await filePkgId({ ...file }))
  })

  it('separates files that differ in any of the three things a browser exposes', async () => {
    const base = await filePkgId(file)
    expect(await filePkgId({ ...file, name: 'other.h5p' })).not.toBe(base)
    expect(await filePkgId({ ...file, size: 2048 })).not.toBe(base)
    expect(await filePkgId({ ...file, lastModified: 1 })).not.toBe(base)
  })

  it('does not collide with a URL that hashes the same strings', async () => {
    expect(await filePkgId(file)).not.toBe(await remotePkgId('course.h5p'))
  })
})
