import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { FIXTURES, createPlayer, frameDocument, frameWindow, play, waitForEvent } from './utils'

/**
 * h5p-standalone's display and loading options, as the element's attributes. Each is read off the
 * runtime's own configuration (`H5PIntegration`) or the frame's DOM, not off the element, so what
 * is pinned is what the content actually sees.
 */

interface Integration {
  reportingIsEnabled?: boolean
  user?: { name: string; mail: string }
  contents: Record<
    string,
    {
      url?: string
      exportUrl?: string
      resizeCode?: string
      fullScreen?: unknown
      displayOptions?: Record<string, boolean>
      metadata?: Record<string, unknown>
    }
  >
}

const integration = (win: Window) => (win as unknown as { H5PIntegration: Integration }).H5PIntegration
const content = (win: Window) => Object.values(integration(win).contents)[0]
/** What the runtime handed the fixture content type's constructor; the fixture keeps it. */
const extrasOf = (win: Window) =>
  (win as unknown as { H5P: { instances: Array<{ extras: Record<string, unknown> }> } }).H5P.instances[0].extras

interface Statement {
  actor?: { name?: string; mbox?: string }
  object?: { id?: string; definition?: { name?: Record<string, string> } }
}

/** Presses the fixture's Complete button and returns the statement it sends. */
async function complete(player: HTMLElement): Promise<Statement> {
  const xapi = waitForEvent<{ statement: Statement }>(player, 'xapi')
  frameDocument(player as never).querySelector<HTMLButtonElement>('.h5p-offline-test-complete')!.click()
  return (await xapi).detail.statement
}

describe('h5p-standalone options', () => {
  it('hides the action bar by default and shows it when asked, with the buttons the content is told to offer', async () => {
    const plain = await play(FIXTURES.basic)
    expect(frameDocument(plain).querySelector('.h5p-actions')).toBeNull()
    expect(content(frameWindow(plain)).displayOptions?.frame).toBe(false)

    // The copyright button shows because the fixture's h5p.json names a licence (CC BY): the
    // runtime turns it off itself for content with no copyright information, which is what every
    // package was until the manifest's metadata reached the frame. The embed button is subject to
    // the runtime's checks too, so for it what is pinned is the request in the boot config.
    const player = await play(FIXTURES.basic, {
      frame: '',
      icon: '',
      copyright: '',
      embed: '',
      'embed-code': '<iframe src="https://site.example/embed" width=":w" height=":h"></iframe>',
      'resize-code': '<script src="https://site.example/h5p-resizer.js"></script>'
    })
    const doc = frameDocument(player)
    expect(doc.querySelector('.h5p-actions')).not.toBeNull()
    expect(doc.querySelector('.h5p-actions .h5p-link')).not.toBeNull()
    expect(doc.querySelector('.h5p-actions .h5p-copyrights')).not.toBeNull()
    expect(content(frameWindow(player)).displayOptions).toMatchObject({ frame: true, icon: true, copyright: true })
    const requested = JSON.parse(doc.getElementById('h5p-boot-config')!.textContent!).options
    expect(requested).toMatchObject({ frame: true, icon: true, copyright: true, embed: true })
    expect(requested.embedCode).toContain(':w')
    // What the dialog's "advanced" box shows: a sizing script the host hands out with its embed.
    expect(content(frameWindow(player)).resizeCode).toContain('h5p-resizer.js')

    // No file to offer, so no download button, whatever the attribute says.
    const noFile = await play(FIXTURES.basic, { frame: '', export: 'off' })
    expect(content(frameWindow(noFile)).displayOptions?.export).toBe(false)
  })

  it('offers the package itself for download when export is on and the package has a URL', async () => {
    const player = await play(FIXTURES.basic, { frame: '', export: '' })
    const button = frameDocument(player).querySelector<HTMLElement>('.h5p-export')
    expect(button).not.toBeNull()
    expect(content(frameWindow(player)).displayOptions?.export).toBe(true)
    expect(content(frameWindow(player)).exportUrl).toBe(new URL(FIXTURES.basic, location.href).href)
  })

  it('hands the runtime the package’s own metadata, which names the activity in every statement', async () => {
    const player = await play(FIXTURES.basic)
    expect(content(frameWindow(player)).metadata).toMatchObject({ title: 'Offline player test', license: 'CC BY', licenseVersion: '4.0' })
    const statement = await complete(player)
    expect(statement.object?.definition?.name).toEqual({ 'en-US': 'Offline player test' })
  })

  it('keeps fullscreen on by default and turns it off with fullscreen="off"', async () => {
    const on = await play(FIXTURES.basic)
    expect(content(frameWindow(on)).fullScreen).toBeTruthy()
    const off = await play(FIXTURES.basic, { fullscreen: 'off' })
    expect(content(frameWindow(off)).fullScreen).toBeFalsy()
  })

  it('loads a custom stylesheet and a custom script into the frame', async () => {
    const player = await play(FIXTURES.basic, {
      'custom-css': '/tests/browser/custom/custom.css',
      'custom-js': '/tests/browser/custom/custom.js'
    })
    const doc = frameDocument(player)
    expect(doc.querySelector('link[href$="/tests/browser/custom/custom.css"]')).not.toBeNull()
    expect(getComputedStyle(doc.body).getPropertyValue('--h5p-test-custom').trim()).toBe('applied')
    expect((frameWindow(player) as unknown as { __h5pCustom?: string }).__h5pCustom).toBe('ran')
  })

  it('turns the submit button on with reporting, where the content reads it: the integration and the instance', async () => {
    const off = await play(FIXTURES.basic)
    expect(integration(frameWindow(off)).reportingIsEnabled).toBe(false)
    expect(extrasOf(frameWindow(off)).isReportingEnabled).toBeUndefined()
    // Question Set, Interactive Video and Course Presentation read `extras.isReportingEnabled`,
    // which this core never sets; the frame sets it on the top-level instance.
    const on = await play(FIXTURES.basic, { reporting: '' })
    expect(integration(frameWindow(on)).reportingIsEnabled).toBe(true)
    expect(extrasOf(frameWindow(on))).toMatchObject({ standalone: true, isReportingEnabled: true })
  })

  it('names the package URL as the activity by default, not the frame’s own URL', async () => {
    const player = await play(FIXTURES.basic)
    const statement = await complete(player)
    expect(statement.object?.id).toBe(new URL(FIXTURES.basic, location.href).href)
  })

  it('names the activity the host asked for', async () => {
    const player = await play(FIXTURES.basic, { 'activity-id': 'https://lms.example/activities/quiz-1' })
    const statement = await complete(player)
    expect(statement.object?.id).toBe('https://lms.example/activities/quiz-1')
  })

  it('makes the learner the host named the actor of every statement', async () => {
    const player = createPlayer()
    player.user = { name: 'Ada Lovelace', mail: 'ada@example.com' }
    const ready = waitForEvent(player, 'ready')
    player.setAttribute('src', FIXTURES.basic)
    await ready
    expect(integration(frameWindow(player)).user).toEqual({ name: 'Ada Lovelace', mail: 'ada@example.com' })
    const statement = await complete(player)
    expect(statement.actor?.name).toBe('Ada Lovelace')
    expect(statement.actor?.mbox).toBe('mailto:ada@example.com')
  })

  it('leaves the actor anonymous when no learner is named', async () => {
    const player = await play(FIXTURES.basic)
    expect(integration(frameWindow(player)).user).toBeUndefined()
    const statement = await complete(player)
    expect(statement.actor?.mbox).toBeUndefined()
  })
})
