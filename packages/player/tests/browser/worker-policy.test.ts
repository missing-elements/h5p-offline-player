import { beforeAll, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { FIXTURES, clearPackageCaches, play } from './utils'

/**
 * A host page whose policy refuses a `blob:` worker — `worker-src 'self'`, or a `script-src
 * 'self'` with no `worker-src` at all, which is common on locked-down sites. The element spawns
 * the Jobs worker from a `blob:` URL by default, so under such a policy it has to fall back to
 * `h5p-jobs.js`. A host without `Range` is what proves it: that archive is downloaded by the Jobs
 * worker before anything can play.
 *
 * The policy is a `<meta>` added to this file's own test frame, so it reaches no other file, and
 * it only ever tightens: every test after `beforeAll` runs under it.
 */
describe('a page that refuses blob: workers', () => {
  const blocked: string[] = []

  beforeAll(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective === 'worker-src') blocked.push(event.blockedURI)
    })
    const policy = document.createElement('meta')
    policy.httpEquiv = 'Content-Security-Policy'
    policy.content = "worker-src 'self'"
    document.head.append(policy)
  })

  it('downloads through h5p-jobs.js after the blob: URL is refused', async () => {
    await clearPackageCaches()
    blocked.length = 0

    await play(FIXTURES.noRangeBasic)

    expect(blocked.some((uri) => uri.startsWith('blob'))).toBe(true)
  })

  it('never tries the blob: URL when `jobs` names the file', async () => {
    await clearPackageCaches()
    blocked.length = 0

    // Where the element finds it on this dev server: beside its own source.
    await play(FIXTURES.noRangeBasic, { jobs: '/src/h5p-jobs.js' })

    expect(blocked).toEqual([])
  })
})
