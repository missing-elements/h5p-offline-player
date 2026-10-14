import { describe, expect, it } from 'vitest'
import '../../src/h5p-offline-player'
import type { H5PPlayerElement } from '../../src/h5p-offline-player'
import { FIXTURES, frameDocument, play, waitForEvent } from './utils'

/**
 * `finished` is the content's result: a `completed` or `answered` statement from the content
 * itself, never one from a part inside it — H5P's own rule, the one the CMS plugins record through
 * `setFinished`, and a part the core marks as sub-content without naming a parent besides.
 * `finished.h5p` is the fixture content type with an Answer button, which reports `answered` the
 * way a single question does, a child of itself run as sub-content, whose Complete reports
 * `completed` with the parent named, and another child run without a parent.
 */

type Detail = {
  statement: {
    verb: { id: string }
    object?: { definition?: { extensions?: Record<string, unknown> } }
    context?: { contextActivities?: { parent?: unknown } }
    result?: { score?: { raw: number; max: number } }
  }
}

const verb = (name: string) => `http://adlnet.gov/expapi/verbs/${name}`

const recorded = (player: H5PPlayerElement) => {
  const events: Detail[] = []
  player.addEventListener('finished', (event) => events.push((event as CustomEvent<Detail>).detail))
  return events
}

const button = (player: H5PPlayerElement, selector: string) => frameDocument(player).querySelector<HTMLButtonElement>(selector)!

describe('the finished event', () => {
  it("is not raised for a part's completion", async () => {
    const player = await play(FIXTURES.finished)
    const finished = recorded(player)

    const xapi = waitForEvent<Detail>(player, 'xapi')
    button(player, '.h5p-offline-test-child .h5p-offline-test-complete').click()
    const part = (await xapi).detail.statement
    expect(part.verb.id).toBe(verb('completed'))
    expect(part.context?.contextActivities?.parent).toBeTruthy()

    // The frame posts `finished` straight after the statement it is about, so a moment is enough.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(finished).toEqual([])
  })

  it("is not raised for a part's completion when the part names no parent", async () => {
    // Interactive Book's chapters and Game Map's exercises are run this way; H5P's own rule, the
    // parent alone, took their results for the content's.
    const player = await play(FIXTURES.finished)
    const finished = recorded(player)

    const xapi = waitForEvent<Detail>(player, 'xapi')
    button(player, '.h5p-offline-test-loose .h5p-offline-test-complete').click()
    const part = (await xapi).detail.statement
    expect(part.verb.id).toBe(verb('completed'))
    expect(part.context?.contextActivities?.parent).toBeUndefined()
    expect(part.object?.definition?.extensions?.['http://h5p.org/x-api/h5p-subContentId']).toBe('4b8e2d6f-1a3c-4e5f-9b7d-2c4e6a8f0b1d')

    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(finished).toEqual([])
  })

  it("is raised for a single question's answer, each time it is given", async () => {
    const player = await play(FIXTURES.finished)

    for (let attempt = 0; attempt < 2; attempt++) {
      const finished = waitForEvent<Detail>(player, 'finished')
      button(player, '.h5p-offline-test-answer').click()
      const { statement } = (await finished).detail
      expect(statement.verb.id).toBe(verb('answered'))
      expect(statement.context?.contextActivities?.parent).toBeUndefined()
      expect(statement.result?.score).toMatchObject({ raw: 1, max: 2 })
    }
  })

  it("is raised for the content's own completion", async () => {
    const player = await play(FIXTURES.finished)
    const finished = waitForEvent<Detail>(player, 'finished')
    // The content's own Complete comes before its part's in the document.
    button(player, '.h5p-offline-test-complete').click()
    expect((await finished).detail.statement.verb.id).toBe(verb('completed'))
  })
})
