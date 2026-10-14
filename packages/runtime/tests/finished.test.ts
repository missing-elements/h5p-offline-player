import { describe, expect, it } from 'vitest'
import { isResult, SUB_CONTENT_EXTENSION } from '../src/finished'

const verb = (name: string) => ({ id: `http://adlnet.gov/expapi/verbs/${name}` })
const parent = { contextActivities: { parent: [{ id: 'https://example.org/h5p/1' }] } }

describe("the content's result", () => {
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

  it('is not one from sub-content created without a parent', () => {
    // Interactive Book's chapters and Game Map's exercises: no parent, the core's mark on the object.
    const chapter = {
      id: 'https://example.org/h5p/1?subContentId=9d3c1f0a',
      definition: { extensions: { 'http://h5p.org/x-api/h5p-local-content-id': 1, [SUB_CONTENT_EXTENSION]: '9d3c1f0a' } }
    }
    expect(isResult({ verb: verb('completed'), object: chapter })).toBe(false)
    expect(isResult({ verb: verb('answered'), object: chapter, context: {} })).toBe(false)
  })

  it('takes an object without the mark as the content itself', () => {
    const content = { id: 'https://example.org/h5p/1', definition: { extensions: { 'http://h5p.org/x-api/h5p-local-content-id': 1 } } }
    expect(isResult({ verb: verb('completed'), object: content })).toBe(true)
    expect(isResult({ verb: verb('answered'), object: { definition: { extensions: { [SUB_CONTENT_EXTENSION]: '' } } } })).toBe(true)
    expect(isResult({ verb: verb('answered'), object: { definition: {} } })).toBe(true)
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
