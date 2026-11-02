import { pack } from '@missing-elements/h5p-libraries'
import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { buildPackage, openPack } from '../../lib/browser.mjs'

// The page's build in Chromium, as a page runs it: the pack a bundler emits, a picture the page
// was given as a `File`, the package back as a `Blob`. Its bytes go to Node, where the verifier
// plays them untrusted, as a site that did not make them plays them (`playUntrusted`, in
// vitest.config.ts). tests/page.test.ts runs the same build in Node, against the build there.

declare module 'vitest/browser' {
  interface BrowserCommands {
    playUntrusted: (name: string, base64: string) => Promise<{
      verdict: 'pass' | 'fail', reasons: string[], warnings: string[], errors: unknown[], state: string, untrusted: boolean,
      contentCheck: { notes: string[], changes: unknown[] | null } | null
    }>
  }
}

const META = { title: 'Rivers', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
const BLANKS = { ...META, type: 'H5P.Blanks', params: { text: 'Fill in the names of the rivers.', questions: ['The *Danube* reaches the Black Sea.', 'Paris lies on the *Seine*.'] } }
const QUIZ = {
  ...META,
  type: 'H5P.QuestionSet',
  params: {
    passPercentage: 50,
    questions: [
      {
        library: 'H5P.MultiChoice',
        metadata: { title: 'The longest river' },
        params: {
          media: { type: { library: 'H5P.Image', params: { file: { path: 'volga.png' }, alt: 'The Volga at Yaroslavl' } } },
          question: 'Which river is the longest in Europe?',
          answers: [{ text: 'Volga', correct: true }, { text: 'Danube', correct: false }]
        }
      },
      { library: 'H5P.TrueFalse', metadata: { title: 'The Rhine' }, params: { question: 'The Rhine flows into the North Sea.', correct: 'true' } }
    ]
  }
}

/** A picture as a page is given one: a file the person chose, here drawn. */
async function picture(width: number, height: number, name: string) {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')!
  context.fillStyle = '#2a6f97'
  context.fillRect(0, 0, width, height)
  return new File([await canvas.convertToBlob({ type: 'image/png' })], name, { type: 'image/png' })
}

/** A `Blob` as base64, which a command's arguments carry to Node. */
function base64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

describe('the build in a page', () => {
  it('builds H5P.Blanks and a Question Set with a picture, which play untrusted with nothing changed by the content check', async () => {
    expect(isSecureContext).toBe(true)
    const libraries = await openPack(pack)
    try {
      const blanks = await buildPackage(BLANKS, { libraries })
      const quiz = await buildPackage(QUIZ, { libraries, files: { 'volga.png': await picture(480, 270, 'IMG_0412.png') } })
      expect(quiz.media).toEqual(['images/volga.png'])
      expect((quiz.content as any).questions[0].params.media.type.params.file).toMatchObject({ path: 'images/volga.png', mime: 'image/png', width: 480, height: 270 })
      for (const [name, built] of [['blanks.h5p', blanks], ['quiz.h5p', quiz]] as const) {
        expect(built.notes, name).toEqual([])
        const report = await commands.playUntrusted(name, await base64(built.blob))
        expect(report, name).toMatchObject({ verdict: 'pass', reasons: [], warnings: [], errors: [], state: 'ready', untrusted: true })
        expect(report.contentCheck, name).toEqual({ notes: [], changes: [] })
      }
    } finally {
      await libraries.close()
    }
  })
})
