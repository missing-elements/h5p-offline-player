import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, SourceError } from '../lib/author.mjs'
import { imageSize } from '../lib/media.mjs'
import { GENERATED_END, GENERATED_START, schemaLines, schemaMarkdown } from '../lib/schema.mjs'
import { jpeg, png } from './helpers/media'

const META = { title: 'Layout', language: 'en', license: 'U', authors: [{ name: 'Ann Author', role: 'Author' }] }
let dir: string
let count = 0
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'h5p-author-layout-')) })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

async function build(type: string, params: unknown, options: Parameters<typeof buildPackage>[2] = {}) {
  const result = await buildPackage({ ...META, type, params }, join(dir, `layout-${++count}.h5p`), options)
  return result.content as Record<string, any> & { notes?: never }
}

async function result(type: string, params: unknown, options: Parameters<typeof buildPackage>[2] = {}) {
  return buildPackage({ ...META, type, params }, join(dir, `layout-${++count}.h5p`), options)
}

async function problems(type: string, params: unknown) {
  const error = await buildPackage({ ...META, type, params }, join(dir, `failed-${++count}.h5p`)).then(() => null, (error: unknown) => error)
  expect(error).toBeInstanceOf(SourceError)
  return (error as SourceError).problems.map(({ path, message }) => `${path}: ${message}`)
}

const question = { library: 'H5P.TrueFalse', params: { question: 'Rivers flow downhill.' } }

describe('Course Presentation', () => {
  it('stacks elements nobody placed down the slide, and keeps those placed by hand', async () => {
    const content = await build('H5P.CoursePresentation', {
      presentation: {
        slides: [
          { elements: [{ action: { library: 'H5P.AdvancedText', params: { text: '<h2>Rivers</h2><p>Water runs down to the sea.</p>' } } }, { action: question }] },
          { elements: [{ x: 10, y: 10, width: 30, height: 20, action: { library: 'H5P.AdvancedText', params: { text: 'Placed' } } }, { action: question }] }
        ]
      }
    })
    const [first, second] = content.presentation.slides.map((slide: { elements: { x: number, y: number, width: number, height: number }[] }) => slide.elements)
    expect(first[0]).toMatchObject({ x: 4, y: 5, width: 92 })
    expect(first[1].y).toBeGreaterThan(first[0].y + first[0].height)
    expect(first[1].y + first[1].height).toBeLessThanOrEqual(95.5)
    expect(second[0]).toMatchObject({ x: 10, y: 10, width: 30, height: 20 })
    expect(second[1].y).toBeGreaterThanOrEqual(30)
  })

  it('says when a slide holds more than fits', async () => {
    const long = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} about rivers, lakes, seas and the water cycle that joins them.</p>`).join('')
    const { notes } = await result('H5P.CoursePresentation', { presentation: { slides: [{ elements: [{ action: { library: 'H5P.AdvancedText', params: { text: long } } }, { action: question }] }] } })
    expect(notes).toEqual([{ path: 'params.presentation.slides[0]', message: expect.stringContaining('likely holds more than fits on one slide') }])
  })
})

describe('Interactive Video', () => {
  it('places interactions nobody placed, apart when they show at the same time, and names their library', async () => {
    const content = await build('H5P.InteractiveVideo', {
      interactiveVideo: {
        video: { files: [{ path: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] },
        assets: {
          interactions: [
            { duration: { from: 2, to: 8 }, action: question },
            { duration: { from: 4, to: 6 }, displayType: 'poster', action: question },
            { duration: { from: 20, to: 22 }, action: question }
          ]
        }
      }
    })
    const [a, b, c] = content.interactiveVideo.assets.interactions
    expect(a).toMatchObject({ x: 5, y: 5, libraryTitle: 'True/False Question' })
    // Below the button shown with it.
    expect(b).toMatchObject({ x: 5, y: 20, width: 17, height: 16 })
    expect(c).toMatchObject({ x: 5, y: 5 })
    // The summary task nobody opened stays as the editor leaves it.
    expect(content.interactiveVideo.summary.task.library).toMatch(/^H5P\.Summary /)
  })

  it('sizes a poster by what it holds, and puts posters shown together side by side', async () => {
    await writeFile(join(dir, 'photo.png'), png(1600, 1200))
    const poster = (from: number, action: unknown, size = {}) => ({ duration: { from, to: from + 4 }, displayType: 'poster', action, ...size })
    const { content, notes } = await result('H5P.InteractiveVideo', {
      interactiveVideo: {
        video: { files: [{ path: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] },
        assets: {
          interactions: [
            poster(1, question),
            poster(2, question),
            poster(3, question),
            poster(10, { library: 'H5P.Text', params: { text: 'All of this water ends in the sea.' } }),
            poster(20, { library: 'H5P.Image', params: { file: { path: 'photo.png' }, alt: 'A river' } }),
            poster(30, question, { width: 30, height: 20 })
          ]
        }
      }
    }, { base: dir })
    const [first, second, third, text, image, written] = (content as Record<string, any>).interactiveVideo.assets.interactions
    // A question gets room for its answers and buttons; 10 by 10, the editor's start, hid them.
    expect(first).toMatchObject({ x: 5, y: 5, width: 17, height: 16 })
    expect(second).toMatchObject({ x: 50, y: 5, width: 17, height: 16 })
    expect(third).toMatchObject({ x: 5, y: 5 })
    expect(notes).toEqual([{ path: 'params.interactiveVideo.assets.interactions[2]', message: expect.stringContaining('has no room left for it') }])
    // A text its lines, a picture its shape, as the editor gives one.
    expect(text).toMatchObject({ x: 5, y: 5, width: 12, height: 5.6 })
    expect(image).toMatchObject({ width: 13.33, height: 10 })
    expect(written).toMatchObject({ width: 30, height: 20 })
  })

  it('refuses an interaction that ends before it starts', async () => {
    expect(await problems('H5P.InteractiveVideo', {
      interactiveVideo: { video: { files: [{ path: 'https://youtu.be/dQw4w9WgXcQ' }] }, assets: { interactions: [{ duration: { from: 9, to: 3 }, action: question }] } }
    })).toEqual(['params.interactiveVideo.assets.interactions[0].duration: ends at 3 s, before it starts at 9 s'])
  })
})

describe('Branching Scenario', () => {
  const text = (words: string) => ({ library: 'H5P.AdvancedText', params: { text: words } })
  const choose = (...targets: number[]) => ({
    library: 'H5P.BranchingQuestion',
    params: { branchingQuestion: { question: 'Which way?', alternatives: targets.map((target, i) => ({ text: `Way ${i + 1}`, nextContentId: target })) } }
  })

  it('builds a scenario whose every path reaches an end', async () => {
    const content = await build('H5P.BranchingScenario', {
      branchingScenario: { title: 'Paths', content: [{ type: text('Start'), nextContentId: 1 }, { type: choose(2, -1) }, { type: text('Branch'), nextContentId: -2 }], endScreens: [{ endScreenTitle: 'End' }, { endScreenTitle: 'Other end' }] }
    })
    expect(content.branchingScenario.endScreens.map(({ contentId }: { contentId: number }) => contentId)).toEqual([-1, -2])
    expect(content.branchingScenario.content[1].nextContentId).toBe(-1)
  })

  it('refuses a node with no next, a link to nothing, and a loop with no way out', async () => {
    expect(await problems('H5P.BranchingScenario', {
      branchingScenario: { title: 'Paths', content: [{ type: text('Start') }, { type: choose(2, 7) }, { type: text('Loop'), nextContentId: 3 }, { type: text('Back'), nextContentId: 2 }] }
    })).toEqual([
      'params.branchingScenario.content[0].nextContentId: is required: the index in content of the node that follows, or -1 to end the scenario here',
      'params.branchingScenario.content[1].type.params.branchingQuestion.alternatives[1].nextContentId: is 7, but content has 4 nodes, 0 to 3'
    ])
    expect(await problems('H5P.BranchingScenario', {
      branchingScenario: { title: 'Paths', content: [{ type: text('Start'), nextContentId: 1 }, { type: text('Loop'), nextContentId: 2 }, { type: text('Back'), nextContentId: 1 }] }
    })).toEqual([
      'params.branchingScenario.content[0]: leads only into a loop: no path from it reaches an end, so a learner there cannot finish',
      'params.branchingScenario.content[1]: leads only into a loop: no path from it reaches an end, so a learner there cannot finish',
      'params.branchingScenario.content[2]: leads only into a loop: no path from it reaches an end, so a learner there cannot finish'
    ])
  })
})

describe('Game Map', () => {
  it('joins stages named by label both ways, and sets the ids, types and positions the editor keeps', async () => {
    await writeFile(join(dir, 'map.png'), png(400, 300))
    const content = await build('H5P.GameMap', {
      gamemapSteps: {
        backgroundImageSettings: { backgroundImage: { path: 'map.png' } },
        gamemap: {
          elements: [
            { label: 'Harbour', canBeStartStage: true, telemetry: { x: 20, y: 60 }, neighbors: ['Market'], contentsList: [{ contentType: question }] },
            { label: 'Market', contentsList: [{ contentType: question }] }
          ]
        }
      }
    }, { base: dir })
    const [harbour, market] = content.gamemapSteps.gamemap.elements
    expect(harbour).toMatchObject({ type: 'stage', neighbors: ['1'], telemetry: { x: '20', y: '60', width: '6', height: '10' } })
    expect(market).toMatchObject({ type: 'stage', neighbors: ['0'] })
    expect(harbour.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('refuses a map with no start, a neighbour that is no stage, and a stage with no content', async () => {
    const list = await problems('H5P.GameMap', {
      gamemapSteps: { gamemap: { elements: [{ label: 'Harbour', neighbors: ['Moon'], contentsList: [{ contentType: question }] }, { label: 'Market' }] } }
    })
    expect(list).toEqual([
      'params.gamemapSteps.gamemap.elements[0].neighbors[0]: "Moon" names no other stage; the stages are "Harbour", "Market"',
      'params.gamemapSteps.gamemap.elements: has no stage a learner can start at: set "canBeStartStage": true on one',
      'params.gamemapSteps.gamemap.elements[1].contentsList: is required for a stage: write at least 1 content'
    ])
  })
})

describe('chapters and question sets', () => {
  it('asks for a chapter\'s title, which the book\'s contents list it by', async () => {
    expect(await problems('H5P.InteractiveBook', { chapters: [{ library: 'H5P.Column', params: { content: [{ content: question }] } }] })).toEqual([
      'params.chapters[0].metadata.title: is required: the chapter\'s name in the table of contents'
    ])
  })
})

describe('the schema a source is written from', () => {
  const semantics = [
    { name: 'intro', type: 'text', widget: 'html', tags: ['strong', 'em'], label: 'Introduction', default: 'Hello' },
    { name: 'words', type: 'text', widget: 'textarea', label: 'Text', important: { description: '<ul><li>Mark answers with *asterisks*.</li></ul>', example: 'A *word*.' } },
    { name: 'answers', type: 'list', min: 2, max: 4, label: 'Answers', field: { name: 'answer', type: 'group', fields: [{ name: 'text', type: 'text' }, { name: 'correct', type: 'boolean' }] } },
    { name: 'media', type: 'group', fields: [{ name: 'type', type: 'library', optional: true, options: ['H5P.Image 1.1', 'H5P.Gone 1.0'] }] },
    { name: 'mode', type: 'select', default: 'a', options: [{ value: 'a' }, { value: 'b' }], label: 'Mode' },
    { name: 'x', type: 'number', widget: 'none' },
    { name: 'shown', type: 'boolean', label: 'Shown', default: true },
    { name: 'l10n', type: 'group', common: true, fields: [{ name: 'check', type: 'text', default: 'Check' }, { name: 'retry', type: 'text', default: 'Retry' }] }
  ]

  it('lists each field as a source writes it: kind, required, default, syntax, and sub-content the pack has', () => {
    const { lines, interfaceTexts } = schemaLines(semantics, { has: (name) => name !== 'H5P.Gone', sets: ['x'] })
    expect(lines).toEqual([
      '- `intro` html: strong em = "Hello" — Introduction',
      '- `words` text, multi-line, required — Text',
      '  Mark answers with *asterisks*. Example: A *word*.',
      '- `answers` list 2–4 of, required — Answers',
      '  - `text` text, required',
      '  - `correct` boolean',
      '- `media` sub-content: H5P.Image',
      '- `mode` one of "a" | "b" = "a" — Mode',
      '- `shown` boolean = true — Shown'
    ])
    expect(interfaceTexts).toBe(2)
    expect(schemaLines(semantics).lines).toContain('- `x` number, required, hidden in the editor')
    expect(schemaLines(semantics, { all: true }).lines).toContain('  - `check` text = "Check"')
  })

  it('writes a type file\'s generated section between its markers', () => {
    const markdown = schemaMarkdown({ machineName: 'H5P.Test', majorVersion: 1, minorVersion: 2 }, semantics)
    expect(markdown.startsWith(`${GENERATED_START}\n\n## Fields of H5P.Test 1.2\n`)).toBe(true)
    expect(markdown.endsWith(`\`h5p-author schema H5P.Test --all\` lists them, for a source to set one.\n\n${GENERATED_END}`)).toBe(true)
  })
})

describe('what a file is', () => {
  /** A file's bytes as the build reads them, from an offset. */
  const file = (bytes: Uint8Array) => async (offset: number, length: number) => bytes.subarray(offset, offset + length)

  it('reads an image\'s size from its header, a JPEG\'s past any segments before it', async () => {
    const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 3, 0, 5, 0])
    const bmp = new Uint8Array(26)
    bmp.set([66, 77])
    new DataView(bmp.buffer).setInt32(18, 7, true)
    new DataView(bmp.buffer).setInt32(22, -9, true)
    expect(await imageSize(file(png(4, 6)))).toEqual({ width: 4, height: 6 })
    expect(await imageSize(file(gif))).toEqual({ width: 3, height: 5 })
    expect(await imageSize(file(bmp))).toEqual({ width: 7, height: 9 })
    expect(await imageSize(file(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 120, 0, 160, 3])))).toEqual({ width: 160, height: 120 })
    // A colour profile in three segments, 150 kB of them before the frame header.
    expect(await imageSize(file(jpeg(1600, 1200, 150_000)))).toEqual({ width: 1600, height: 1200 })
    expect(await imageSize(file(jpeg(1600, 1200).subarray(0, 8)))).toBeNull()
    expect(await imageSize(file(new Uint8Array([1, 2, 3])))).toBeNull()
  })
})
