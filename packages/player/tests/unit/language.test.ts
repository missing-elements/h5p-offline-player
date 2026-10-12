import { describe, expect, it } from 'vitest'
import { isEnglish, languageTag } from '../../src/shared/language'

describe('languageTag', () => {
  it.each([
    ['de', 'de'],
    ['pt-BR', 'pt-BR'],
    [' de-AT ', 'de-AT'],
    ['de_DE', 'de-DE'],
    ['zh-Hant-TW', 'zh-Hant-TW']
  ])('reads %j as %s', (declared, tag) => {
    expect(languageTag(declared)).toBe(tag)
  })

  it.each([[undefined], [''], ['de-'], ['de AT'], ['<script>'], ['x-klingon']])('reads %j as no tag', (declared) => {
    expect(languageTag(declared)).toBeUndefined()
  })
})

describe('isEnglish', () => {
  it.each([
    ['en', true],
    ['EN-gb', true],
    ['en-US-x-pirate', true],
    ['de', false],
    ['ne', false],
    ['eng', false]
  ])('%s: %s', (tag, english) => {
    expect(isEnglish(tag)).toBe(english)
  })
})
