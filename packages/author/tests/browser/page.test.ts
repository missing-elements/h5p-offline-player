import { BlobReader, type FileEntry, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import { pack } from '@missing-elements/h5p-libraries/install'
import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { buildPackage, openPack } from '../../lib/browser.mjs'
import { mp4 } from '../helpers/mp4'

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

  it('reads a video\'s index from the File it was given, as a build in Node reads it from disk (#218)', async () => {
    const libraries = await openPack(pack)
    try {
      const clip = new File([mp4(false, { seconds: 30, tracks: [['vide', 'avc1']] })], 'clip.mp4', { type: 'video/mp4' })
      const source = (from: number) => ({
        ...META,
        type: 'H5P.InteractiveVideo',
        params: { interactiveVideo: { video: { files: [{ path: 'clip.mp4' }] }, assets: { interactions: [{ duration: { from, to: from + 2 }, label: 'Look', action: { library: 'H5P.Text', params: { text: 'Look' } } }] } } }
      })
      const built = await buildPackage(source(5), { libraries, files: { 'clip.mp4': clip } })
      expect(built.notes.filter(({ path }) => path.endsWith('.path'))).toEqual([{ path: 'params.interactiveVideo.video.files[0].path', message: 'clip.mp4 has no sound' }])
      // Stored with its index first, as Node's build lays it out, and its CRC that of what is stored.
      const reader = new ZipReader(new BlobReader(built.blob), { checkSignature: true })
      try {
        const entry = (await reader.getEntries()).find(each => each.filename === 'content/videos/clip.mp4') as FileEntry
        const stored = await entry.getData(new Uint8ArrayWriter())
        const text = new TextDecoder('latin1').decode(stored)
        expect(entry.compressionMethod).toBe(0)
        expect(stored.length).toBe(clip.size)
        expect(text.indexOf('moov')).toBeGreaterThan(0)
        expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
      } finally { await reader.close() }
      await expect(buildPackage(source(40), { libraries, files: { 'clip.mp4': clip } })).rejects.toMatchObject({
        problems: [{ path: 'params.interactiveVideo.assets.interactions[0].duration', message: 'starts at 40 s, after the video ends at 30 s' }]
      })
    } finally {
      await libraries.close()
    }
  })
})
