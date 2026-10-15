import { type H5PPlayerElement } from '../../src/h5p-offline-player'
import { afterEach, describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import { FIXTURES, createPlayer, frameDocument, frameWindow, play, waitForSettled } from './utils'

/**
 * The core's own strings in the element's language: what the runtime answers for a key, and the
 * licence names it builds from them in its own ready handler — in the language too, so the
 * strings were in place before that handler ran. Read inside the frame, where the content's
 * buttons and dialogs get them. The element only passes the tag on; the runtime's `l10n.js`,
 * named for any language but English, and its boot script decide which strings that is.
 */

interface Core {
  H5P: {
    t(key: string): string
    copyrightLicenses: Record<string, { label?: string }>
  }
}

const core = (player: H5PPlayerElement) => (frameWindow(player) as unknown as Core).H5P
const strings = (player: H5PPlayerElement) =>
  [...frameDocument(player).querySelectorAll('script[src]')].map((script) => script.getAttribute('src') ?? '').filter((src) => src.includes('l10n.js'))
const l10nJs = new URL('/frame-assets/l10n.js', location.href).href

const pageLanguage = document.documentElement.getAttribute('lang')

afterEach(() => {
  if (pageLanguage === null) document.documentElement.removeAttribute('lang')
  else document.documentElement.setAttribute('lang', pageLanguage)
})

describe('the core’s strings', () => {
  it('are English, and the frame says so, when nothing declares a language', async () => {
    document.documentElement.removeAttribute('lang')
    const player = await play(FIXTURES.basic)
    expect(frameDocument(player).documentElement.lang).toBe('en')
    expect(core(player).t('fullscreen')).toBe('Fullscreen')
    expect(strings(player)).toEqual([])
  })

  it('follow the element’s lang, the licence names with them', async () => {
    const player = await play(FIXTURES.basic, { lang: 'de' })
    expect(frameDocument(player).documentElement.lang).toBe('de')
    expect(core(player).t('fullscreen')).toBe('Vollbild')
    expect(core(player).copyrightLicenses['CC BY'].label).toBe('Namensnennung')
    expect(strings(player)).toEqual([l10nJs])

    // The underscore some systems write for the hyphen.
    const underscored = await play(FIXTURES.basic, { lang: 'de_DE' })
    expect(frameDocument(underscored).documentElement.lang).toBe('de-DE')
    expect(core(underscored).t('fullscreen')).toBe('Vollbild')
  })

  it('follow the page’s language when the element has none, a region’s own where the runtime has it', async () => {
    document.documentElement.setAttribute('lang', 'pt-BR')
    const player = await play(FIXTURES.basic)
    expect(frameDocument(player).documentElement.lang).toBe('pt-BR')
    expect(core(player).t('fullscreen')).toBe('Tela cheia')

    // A region the runtime has nothing of its own for takes the language's.
    document.documentElement.setAttribute('lang', 'de-AT')
    const austrian = await play(FIXTURES.basic)
    expect(frameDocument(austrian).documentElement.lang).toBe('de-AT')
    expect(core(austrian).t('close')).toBe('Schließen')

    // Bokmål is kept under Moodle's Norwegian, which the runtime's aliases know.
    document.documentElement.setAttribute('lang', 'nb-NO')
    const norwegian = await play(FIXTURES.basic)
    expect(core(norwegian).t('fullscreen')).toBe('Fullskjerm')
  })

  it('load no translations in English, whichever English', async () => {
    const player = await play(FIXTURES.basic, { lang: 'en-GB' })
    expect(frameDocument(player).documentElement.lang).toBe('en-GB')
    expect(core(player).t('fullscreen')).toBe('Fullscreen')
    expect(strings(player)).toEqual([])
  })

  it('stay English where a language lacks one, and wholly for a language the runtime has none in', async () => {
    // Greek's translation of this one renamed its placeholder, so the build left it out.
    const greek = await play(FIXTURES.basic, { lang: 'el' })
    expect(core(greek).t('fullscreen')).toBe('Πλήρης οθόνη')
    expect(core(greek).t('offlineDialogRetryMessage')).toBe('Retrying in :num....')

    // The element knows no list of languages, so the frame has the translations and finds none for Thai.
    const thai = await play(FIXTURES.basic, { lang: 'th' })
    expect(frameDocument(thai).documentElement.lang).toBe('th')
    expect(core(thai).t('fullscreen')).toBe('Fullscreen')
    expect(strings(thai)).toEqual([l10nJs])
  })

  it('come from the runtime property’s own files when a host hands them over, and stay English when it has none', async () => {
    const base = new URL('/frame-assets/', location.href).href
    const runtime = {
      mainJs: `${base}main.bundle.js`,
      frameJs: `${base}frame.bundle.js`,
      frameCss: `${base}h5p.css`,
      bootJs: `${base}frame-boot.js`,
      // Relative, as a hand-written one may be: the element resolves it against the page.
      l10nJs: '/frame-assets/l10n.js?via=runtime'
    }
    const translations = new URL(runtime.l10nJs, location.href).href

    const bundled = createPlayer({ lang: 'de' })
    bundled.runtime = runtime
    expect(bundled.runtime?.l10nJs).toBe(translations)
    let settled = waitForSettled(bundled)
    bundled.setAttribute('src', FIXTURES.basic)
    let result = await settled
    if (!result.ok) expect.fail(`${result.detail.code} — ${result.detail.message}`)
    expect(strings(bundled)).toEqual([translations])
    expect(core(bundled).t('fullscreen')).toBe('Vollbild')

    // A runtime from before the translations names no file, and the frame plays in English.
    const older = createPlayer({ lang: 'de' })
    older.runtime = { ...runtime, l10nJs: undefined }
    settled = waitForSettled(older)
    older.setAttribute('src', FIXTURES.basic)
    result = await settled
    if (!result.ok) expect.fail(`${result.detail.code} — ${result.detail.message}`)
    expect(frameDocument(older).documentElement.lang).toBe('de')
    expect(core(older).t('fullscreen')).toBe('Fullscreen')
  })
})
