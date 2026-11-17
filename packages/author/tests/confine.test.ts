import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPackage, loadLibraries, openPack, outlineOf, publicFetch, SourceError } from '../lib/author.mjs'
import { guardedFetch, inside, isPrivateAddress } from '../lib/node.mjs'
import { mp4, png } from './helpers/media'

const exec = promisify(execFile)
const bin = resolve(import.meta.dirname, '../bin/h5p-author.mjs')
const META = { title: 'Rivers', language: 'en', license: 'CC BY', authors: [{ name: 'Ann Author', role: 'Author' }] }
const withImage = (path: string) => ({ ...META, type: 'H5P.Column', params: { content: [{ content: { library: 'H5P.Image', params: { file: { path }, alt: 'A river' } } }] } })
const question = { ...META, type: 'H5P.MultiChoice', params: { question: 'Capital of France?', answers: [{ text: 'Paris', correct: true }, { text: 'Lyon', correct: false }] } }
let dir: string
let allowed: string
let outside: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h5p-author-confine-'))
  allowed = join(dir, 'allowed')
  outside = join(dir, 'outside')
  await mkdir(allowed)
  await mkdir(outside)
  await writeFile(join(allowed, 'in.png'), png(8, 8))
  await writeFile(join(allowed, '..notes.png'), png(8, 8))
  await writeFile(join(allowed, 'clip.mp4'), mp4(true))
  await writeFile(join(outside, 'out.png'), png(8, 8))
  await symlink(join(outside, 'out.png'), join(allowed, 'link.png'))
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

/** A source's outline, from a build that writes nothing. */
async function outline(source: Record<string, unknown>) {
  return (await buildPackage({ ...META, ...source }, undefined, { check: true })).outline
}

describe('within', () => {
  it('builds with a file and an output inside the folders, a name that starts with two dots among them', async () => {
    expect((await buildPackage(withImage('in.png'), join(allowed, 'a.h5p'), { base: allowed, within: [allowed] })).media).toHaveLength(1)
    expect((await buildPackage(withImage('..notes.png'), join(allowed, 'a2.h5p'), { base: allowed, within: [allowed] })).media).toHaveLength(1)
  })

  it('refuses a file outside them, by .. and by a link, and an output outside', async () => {
    await expect(buildPackage(withImage('../outside/out.png'), join(allowed, 'b.h5p'), { base: allowed, within: [allowed] })).rejects.toThrow(SourceError)
    await expect(buildPackage(withImage('link.png'), join(allowed, 'c.h5p'), { base: allowed, within: [allowed] })).rejects.toThrow(/outside the folders/)
    await expect(buildPackage(question, join(outside, 'd.h5p'), { within: [allowed] })).rejects.toThrow(/outside the folders this build may write in/)
    expect(await readdir(outside)).toEqual(['out.png'])
  })

  it('answers a path outside the folders the same whether or not a file is there, and names no absolute path', async () => {
    const at = 'params.content[0].content.params.file.path'
    for (const path of ['../outside/out.png', '../outside/missing.png']) {
      const error = await buildPackage(withImage(path), join(allowed, 'e.h5p'), { base: allowed, within: [allowed] }).catch((caught) => caught)
      expect(error.problems).toEqual([{ path: at, message: `${path}: is outside the folders this build may read` }])
    }
    const error = await buildPackage(withImage('nothing.png'), join(allowed, 'e.h5p'), { base: allowed, within: [allowed] }).catch((caught) => caught)
    expect(error.problems).toEqual([{ path: at, message: 'nothing.png: no such file in the folders this build may read' }])
  })

  it('judges a path that does not exist yet by its nearest folder, and a folder is not its sibling of the same prefix', async () => {
    expect(await inside(join(allowed, 'new', 'x.h5p'), [allowed])).toBe(true)
    expect(await inside(join(allowed, '..notes.png'), [allowed])).toBe(true)
    expect(await inside(join(allowed, '..', 'outside', 'out.png'), [allowed])).toBe(false)
    expect(await inside(`${allowed}-other/x.h5p`, [allowed])).toBe(false)
  })

  it('takes a list of folders, and refuses one folder given alone, which would confine nothing', async () => {
    await expect(buildPackage(withImage('in.png'), join(allowed, 'h.h5p'), { base: allowed, within: allowed as unknown as string[] })).rejects.toThrow(/within takes a list of folders/)
    expect(await readdir(allowed)).not.toContain('h.h5p')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('says a file it cannot read is a problem of the source, in a check too, and names no path', async () => {
    await writeFile(join(allowed, 'locked.mp4'), mp4(true))
    await chmod(join(allowed, 'locked.mp4'), 0o000)
    try {
      const video = { ...META, type: 'H5P.Column', params: { content: [{ content: { library: 'H5P.Video', params: { sources: [{ path: 'locked.mp4' }] } } }] } }
      for (const output of [undefined, join(allowed, 'i.h5p')]) {
        const error = await buildPackage(video, output, { base: allowed, within: [allowed], check: !output }).catch((caught) => caught)
        expect(error.problems, String(output)).toEqual([{ path: 'params.content[0].content.params.sources[0].path', message: 'locked.mp4: cannot be read' }])
      }
    } finally {
      await chmod(join(allowed, 'locked.mp4'), 0o644)
    }
  })
})

describe('check', () => {
  it('takes no output and writes no package, and reports the problems of a wrong source as a build does', async () => {
    const result = await buildPackage(question, undefined, { check: true })
    expect(result.output).toBe('')
    expect(result.manifest.mainLibrary).toBe('H5P.MultiChoice')
    await expect(buildPackage({ ...question, title: undefined }, undefined, { check: true })).rejects.toThrow(SourceError)
    await expect(buildPackage(question, undefined)).rejects.toThrow(/takes the path to write its package to/)
  })

  it('looks at no output: a folder that is not there, outside the folders, is no matter to a check', async () => {
    expect((await buildPackage(question, join(outside, 'no', 'such', 'x.h5p'), { check: true, within: [allowed] })).output).toBe('')
  })

  it('is build --check on the command line, with one argument and no file written', async () => {
    const source = join(allowed, 'q.json')
    await writeFile(source, JSON.stringify(question))
    const before = await readdir(allowed)
    const { stdout } = await exec('node', [bin, 'build', '--check', source])
    expect(stdout).toMatch(/Checked, no package written: H5P.MultiChoice/)
    expect(await readdir(allowed)).toEqual(before)
    await expect(exec('node', [bin, 'build', '--check', source, 'x.h5p'])).rejects.toThrow(/build --check takes a source/)
  })
})

describe('publicFetch', () => {
  let server: Server
  let port: number
  let requests = 0
  beforeAll(async () => {
    server = createServer((request, response) => {
      requests += 1
      response.writeHead(200).end('local')
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => { server.close() })

  it('refuses a local address however it is written, a URL writing ::ffff:127.0.0.1 as ::ffff:7f00:1, and asks nothing of it', async () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::127.0.0.1]', '2130706433', '0x7f.1']) {
      await expect(publicFetch(`http://${host}:${port}/`), host).rejects.toThrow(/not on the public internet/)
    }
    await expect(publicFetch('file:///etc/passwd')).rejects.toThrow(/not fetched/)
    await expect(publicFetch('https://example.com/', { method: 'POST' })).rejects.toThrow(/GET or HEAD/)
    expect(requests).toBe(0)
  })

  it('knows the local ranges, in IPv4 and IPv6, and an IPv4 address written as IPv6', () => {
    for (const address of ['10.0.0.1', '172.16.5.5', '172.31.0.1', '192.168.1.1', '169.254.169.254', '127.0.0.1', '100.64.0.1', '0.0.0.0', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
      '::', '::1', '0:0:0:0:0:0:0:1', '::7f00:1', 'fd00::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:7f00:1',
      '64:ff9b::7f00:1', '64:ff9b::a00:5', '64:ff9b::a9fe:a9fe', '64:ff9b::c0a8:101', '64:ff9b:1::808:808', '2002:a00:1::1', '2002:7f00:1::',
      '192.0.2.1', '198.51.100.7', '203.0.113.9', '2001:db8::1',
      '64:ff9b::c000:201', '2002:c000:201::', '64:ff9b::c633:6407', '2002:c633:6407::', '64:ff9b::cb00:7109', '2002:cb00:7109::',
      '::ffff:0:7f00:1', '::ffff:0:127.0.0.1', '100::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:2::1', '3fff::1', '5f00::1', 'not an address']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
    for (const address of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '2001:4860:4860::8888', '::ffff:808:808', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1']) {
      expect(isPrivateAddress(address), address).toBe(false)
    }
  })

  /** A web of hosts: `public.test` and `cdn.test` resolve to public addresses, `inside.test` to a local one. */
  const web = (answer: (url: URL) => Response) => {
    const asked: string[] = []
    const fetch = guardedFetch({
      lookup: async (host) => [{ address: host === 'inside.test' ? '10.1.2.3' : '93.184.216.34' }],
      fetch: async (input) => {
        const url = new URL(String(input))
        asked.push(url.href)
        return answer(url)
      }
    })
    return { fetch, asked }
  }
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } })

  it('refuses a redirect to a local address, by name and by number, without asking it', async () => {
    for (const location of ['http://inside.test/secret', 'http://[::ffff:127.0.0.1]/secret', 'http://169.254.169.254/latest']) {
      const { fetch, asked } = web((url) => (url.pathname === '/hop' ? redirect(location) : new Response('reached')))
      await expect(fetch('https://public.test/hop'), location).rejects.toThrow(/not on the public internet/)
      expect(asked).toEqual(['https://public.test/hop'])
    }
  })

  it('refuses a name that does not resolve in the words it refuses a local one, so a refusal names no local host', async () => {
    const fetch = guardedFetch({
      lookup: async (host) => {
        if (host === 'inside.test') return [{ address: '10.1.2.3' }]
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
      },
      fetch: async () => new Response('')
    })
    const said = (host: string) => fetch(`https://${host}/`).then(() => 'fetched', (error) => error.message.replace(host, 'HOST'))
    expect(await said('inside.test')).toBe('HOST is not on the public internet, the only place a build here fetches from')
    expect(await said('missing.test')).toBe(await said('inside.test'))
  })

  it('follows a redirect between public hosts, keeps the request\'s headers, and names the address it ended at', async () => {
    let header: string | null = null
    const { fetch, asked } = web((url) => (url.hostname === 'public.test' ? redirect('https://cdn.test/clip.mp4') : new Response('video')))
    const answered = await fetch(new Request('https://public.test/clip', { headers: { 'x-test': 'kept' } }))
    expect(await answered.text()).toBe('video')
    expect(answered.url).toBe('https://cdn.test/clip.mp4')
    expect(asked).toEqual(['https://public.test/clip', 'https://cdn.test/clip.mp4'])
    const seen = guardedFetch({ lookup: async () => [{ address: '93.184.216.34' }], fetch: async (_, init) => { header = new Headers(init?.headers).get('x-test'); return new Response('') } })
    await seen(new Request('https://public.test/', { headers: { 'x-test': 'kept' } }))
    expect(header).toBe('kept')
  })

  it('drops what a request carries for its own site on a redirect to another, and keeps it on its own', async () => {
    const seen: [string, string | null, string | null, string | null][] = []
    const fetch = guardedFetch({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async (input, init) => {
        const url = new URL(String(input))
        const headers = new Headers(init?.headers)
        seen.push([url.href, headers.get('authorization'), headers.get('cookie'), headers.get('accept')])
        return url.pathname === '/a' ? redirect('/b') : url.pathname === '/b' ? redirect('https://other.test/c') : new Response('ok')
      }
    })
    await fetch('https://first.test/a', { headers: { authorization: 'Bearer x', cookie: 'k=v', accept: 'video/*' } })
    expect(seen).toEqual([
      ['https://first.test/a', 'Bearer x', 'k=v', 'video/*'],
      ['https://first.test/b', 'Bearer x', 'k=v', 'video/*'],
      ['https://other.test/c', null, null, 'video/*']
    ])
  })

  it('asks no resolver for a request that is already aborted', async () => {
    let asked = false
    const fetch = guardedFetch({ lookup: async () => { asked = true; return [{ address: '93.184.216.34' }] }, fetch: async () => new Response('') })
    await expect(fetch('https://slow.test/', { signal: AbortSignal.abort(new Error('stopped')) })).rejects.toThrow('stopped')
    expect(asked).toBe(false)
  })

  it('stops waiting for a name when the signal aborts, as a download\'s idle limit does', async () => {
    const hanging = guardedFetch({ lookup: () => new Promise(() => {}), fetch: async () => new Response('') })
    const controller = new AbortController()
    const fetching = hanging('https://slow.test/', { signal: controller.signal })
    controller.abort(new Error('nothing arrived for 60 s'))
    await expect(fetching).rejects.toThrow('nothing arrived for 60 s')
  })

  it('keeps a build it is given to off a local network, and asks nothing there', async () => {
    const before = requests
    const error = await buildPackage(withImage(`http://127.0.0.1:${port}/river.png`), join(allowed, 'g.h5p'), { base: allowed, within: [allowed], fetch: publicFetch }).catch((caught) => caught)
    expect(error).toBeInstanceOf(SourceError)
    expect(error.message).toMatch(/could not be downloaded: 127\.0\.0\.1 is not on the public internet/)
    expect(requests).toBe(before)
  })

  it('answers a redirect as asked: manual returns it, error refuses it, and more than ten are refused', async () => {
    const { fetch } = web(() => redirect('https://cdn.test/next'))
    expect((await fetch('https://public.test/', { redirect: 'manual' })).status).toBe(302)
    await expect(fetch('https://public.test/', { redirect: 'error' })).rejects.toThrow(/redirects were refused/)
    await expect(fetch('https://public.test/')).rejects.toThrow(/more than 10 redirects/)
  })
})

describe('outline', () => {
  it('writes the question, its answers with the right one marked, numbers included, and the feedback by its label', async () => {
    expect(await outline({
      type: 'H5P.MultiChoice',
      params: { question: 'When did Apollo 11 land?', answers: [{ text: '1969', correct: true, tipsAndFeedback: { chosenFeedback: 'Yes, in July.' } }, { text: '1972', correct: false }] }
    })).toBe('When did Apollo 11 land?\n  ✓ 1969\n  Message displayed if answer is selected: Yes, in July.\n  1972')
  })

  it('names the right answer where a select holds it, or where a type takes the first item as the right one', async () => {
    expect(await outline({ type: 'H5P.TrueFalse', params: { question: 'The Rhine flows into the North Sea.', correct: 'true' } }))
      .toBe('The Rhine flows into the North Sea.\nCorrect answer: True')
    expect(await outline({ type: 'H5P.SingleChoiceSet', params: { choices: [{ question: 'Which sea does the Danube reach?', answers: ['Black Sea', 'North Sea'] }] } }))
      .toBe('  Which sea does the Danube reach?\n    ✓ Black Sea\n    North Sea')
    expect(await outline({ type: 'H5P.Summary', params: { summaries: [{ summary: ['Rivers flow downhill.', 'Rivers flow uphill.'] }] } }))
      .toBe('    ✓ Rivers flow downhill.\n    Rivers flow uphill.')
  })

  it('leaves out interface texts, settings and the titles the build gives in any language, numbers questions, and writes the score ranges of a RangeList', async () => {
    const quiz = {
      type: 'H5P.QuestionSet',
      params: {
        questions: [
          { library: 'H5P.TrueFalse', params: { question: 'Water is wet.', correct: 'true' }, metadata: { title: 'Water' } },
          // Titled by the build, "Question 2" or "Frage 2": the set's own label, and not written.
          { library: 'H5P.TrueFalse', params: { question: 'Ice is cold.', correct: 'true' } }
        ],
        endGame: { overallFeedback: [{ from: 0, to: 49, feedback: 'Try again.' }, { from: 50, to: 100, feedback: 'Passed.' }] }
      }
    }
    const expected = [
      '  Question 1', '    Title: Water', '    Water is wet.', '    Correct answer: True',
      '  Question 2', '    Ice is cold.', '    Correct answer: True',
      '  0–49%: Try again.', '  50–100%: Passed.'
    ].join('\n')
    expect(await outline(quiz)).toBe(expected)
    expect(await outline({ ...quiz, language: 'de' })).toBe(expected)
  })

  it('keeps a text\'s paragraphs, lines and list items apart, and numbers slides, with each slide\'s keyword', async () => {
    const text = (html: string) => ({ action: { library: 'H5P.AdvancedText', params: { text: html } } })
    expect(await outline({
      type: 'H5P.CoursePresentation',
      params: { presentation: { slides: [
        { elements: [text('<h2>Rivers</h2><p>The Volga is the longest.</p>')], keywords: [{ main: 'Rivers' }] },
        { elements: [text('<p>Line one<br>Line two</p><ul><li>Danube</li><li>Rhine</li></ul>')] }
      ] } }
    })).toBe('  Slide 1\n      Rivers / The Volga is the longest.\n      Keyword: Rivers\n  Slide 2\n      Line one / Line two / Danube / Rhine')
  })

  it('writes when a video shows each interaction and bookmark, names a bookmark as one, and names the video', async () => {
    expect((await buildPackage({
      ...META,
      type: 'H5P.InteractiveVideo',
      params: { interactiveVideo: {
        video: { files: [{ path: 'clip.mp4' }] },
        assets: { interactions: [{ duration: { from: 2.5, to: 66 }, label: 'Where does it go?', action: { library: 'H5P.Text', params: { text: 'To the sea.' } } }], bookmarks: [{ time: 7, label: 'Question' }] }
      } }
    }, undefined, { check: true, base: allowed })).outline).toBe('Video: videos/clip.mp4\n  0:02.5–1:06 Label: Where does it go?\n  To the sea.\n  0:07 Bookmark: Question')
  })

  it('writes where each choice and content of a scenario leads, but not a question\'s own link, and the scores an author gave', async () => {
    const scenario = await outline({
      type: 'H5P.BranchingScenario',
      params: { branchingScenario: {
        title: 'River',
        startScreen: { startScreenTitle: 'River', startScreenSubtitle: 'Choose.' },
        content: [
          { type: { library: 'H5P.BranchingQuestion', params: { branchingQuestion: { question: 'Cross how?', alternatives: [{ text: 'Wade', nextContentId: 1 }, { text: 'Bridge', nextContentId: -1 }] } } } },
          { type: { library: 'H5P.AdvancedText', params: { text: 'Swept away.' } }, nextContentId: -1, feedback: { title: 'Wet', endScreenScore: 0 } }
        ],
        endScreens: [{ endScreenTitle: 'The end' }]
      } }
    })
    // One block, line after line: no link of the question's own between its last choice and the next content.
    expect(scenario).toContain([
      '  Content 1', '    Cross how?', '      Wade', '      Next: Content 2', '      Bridge', '      Next: the end',
      '  Content 2', '    Swept away.', '    Next: the end', '    Feedback title: Wet', '    Score: 0'
    ].join('\n'))
    expect(scenario.endsWith('    Score: 0')).toBe(true)
  })

  it('numbers chapters, writes an author\'s title but not the content type\'s, and names a picture with its alternative text', async () => {
    expect(await outline({
      type: 'H5P.InteractiveBook',
      params: { chapters: [{ library: 'H5P.Column', metadata: { title: 'Sources' }, params: { content: [{ content: { library: 'H5P.AdvancedText', params: { text: 'A river begins at a spring.' }, metadata: { title: 'Text' } } }] } }] }
    })).toBe('  Chapter 1\n    Title: Sources\n      A river begins at a spring.')
    expect((await buildPackage(withImage('in.png'), undefined, { check: true, base: allowed })).outline).toBe('  Image: images/in.png\n  Alternative text: A river')
  })

  /** A content type of the test's own, with these fields. */
  const own = (semantics: unknown[]) => ({ entries: new Map(), main: { library: { machineName: 'Test.Type', majorVersion: 1, minorVersion: 0 }, semantics } })

  it('reads text as a learner does: every line break and block, a tag inside a word taken out whole, an encoded character as itself, a label as plain text', () => {
    const libraries = own([{ name: 'note', type: 'text', label: 'Tom &amp; Jerry' }, { name: 'text', type: 'text', widget: 'html', tags: ['p', 'a', 'em', 'sub'] }])
    const params = {
      note: 'one\rtwo\r\nthree\nfour',
      text: '<p>a&#xE000;b</p><p>H<sub>2</sub>O and <a title="it\'s" href=it\'s>a link</a>, <em>said</em>.</p>text<p>para'
    }
    expect(outlineOf(libraries, { params })).toBe('Tom & Jerry: one / two / three / four\nab / H2O and a link, said. / text / para')
  })

  it('leaves out what the editor does not draw and a text no label names, and writes a label without a colon of its own', () => {
    const libraries = own([
      // Game Map's stage positions, Find the Hotspot's figure: set by a widget of the type's own.
      { name: 'telemetry', type: 'group', widget: 'none', fields: [{ name: 'x', type: 'text' }, { name: 'y', type: 'text' }] },
      { name: 'figure', type: 'text' },
      { name: 'empty', type: 'text', label: 'Feedback if the user selects an empty spot:' },
      { name: 'items', type: 'list', field: { name: 'item', type: 'text' } }
    ])
    expect(outlineOf(libraries, { params: { telemetry: { x: '15', y: '20' }, figure: 'circle', empty: 'Look again.', items: ['one', 'two'] } }))
      .toBe('Feedback if the user selects an empty spot: Look again.\n  one\n  two')
  })

  it('writes every line where no limit is given, and counts what a limit cuts off', () => {
    const libraries = own([{ name: 'items', type: 'list', field: { name: 'item', type: 'text' } }])
    const params = { items: Array.from({ length: 450 }, (_, index) => `Item ${index + 1}`) }
    expect(outlineOf(libraries, { params }).split('\n')).toHaveLength(450)
    expect(outlineOf(libraries, { params }, { limit: 2 })).toBe('  Item 1\n  Item 2\n… 448 more lines')
  })

  it('is outlineOf over what loadLibraries loaded and the content, as checkContent takes them, made only when a result\'s outline is read', async () => {
    const result = await buildPackage(question, undefined, { check: true })
    expect(typeof Object.getOwnPropertyDescriptor(result, 'outline')?.get).toBe('function')
    const pack = await openPack()
    try {
      const content = { type: 'H5P.MultiChoice', language: 'en', params: question.params }
      const libraries = await loadLibraries(pack, content)
      expect(outlineOf(libraries, { ...content, params: result.content })).toBe(result.outline)
      // The other way round, or the parameters alone, is refused, not an empty outline.
      expect(() => outlineOf(result.content as never, libraries as never)).toThrow(/as checkContent does/)
      expect(() => outlineOf(libraries, result.content as never)).toThrow(/as checkContent does/)
    } finally {
      await pack.close()
    }
  })
})
