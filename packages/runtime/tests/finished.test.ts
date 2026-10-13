import { describe, expect, it } from 'vitest'
import { isResult } from '../src/finished'

const verb = (name: string) => ({ id: `http://adlnet.gov/expapi/verbs/${name}` })
const parent = { contextActivities: { parent: [{ id: 'https://example.org/h5p/1' }] } }

describe("the content's result, as H5P's core decides it", () => {
  it('is a completed or an answered statement from the content itself', () => {
    expect(isResult({ verb: verb('completed') })).toBe(true)
    expect(isResult({ verb: verb('answered'), result: { score: { raw: 0, max: 1 } } })).toBe(true)
  })

  it('is not one from a part inside the content', () => {
    expect(isResult({ verb: verb('completed'), context: parent })).toBe(false)
    expect(isResult({ verb: verb('answered'), context: parent })).toBe(false)
    // The core tests the value for truth, so an empty list still names a parent.
    expect(isResult({ verb: verb('completed'), context: { contextActivities: { parent: [] } } })).toBe(false)
  })

  it('takes a context without a parent as the content itself', () => {
    expect(isResult({ verb: verb('answered'), context: { contextActivities: { category: [{ id: 'x' }] } } })).toBe(true)
    expect(isResult({ verb: verb('completed'), context: {} })).toBe(true)
  })

  it('is no other verb, and nothing that is not a statement', () => {
    for (const name of ['interacted', 'attempted', 'progressed', 'passed', 'failed', 'experienced']) {
      expect(isResult({ verb: verb(name) }), name).toBe(false)
    }
    expect(isResult({ verb: { id: 'https://example.org/verbs/completed' } })).toBe(false)
    for (const value of [undefined, null, 'completed', 42, {}, { verb: {} }]) {
      expect(isResult(value)).toBe(false)
    }
  })
})
