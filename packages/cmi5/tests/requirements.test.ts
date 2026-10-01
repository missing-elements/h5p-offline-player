import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every requirement of the cmi5 specification that falls on the assignable unit, from ADL's own
 * list (`@cmi5/requirements`, the one CATAPULT checks against), and how this package answers it.
 * A requirement marked `tested` must be named by number in one of the other test files, next to
 * the test that shows it. When the list grows, this test names the requirements nobody has
 * placed yet.
 */

type Answer =
  | 'tested' // a test in this directory shows it; its number is next to that test
  | `catapult: ${string}` // shown by `pnpm cmi5:catapult` against the reference launching system
  | `host: ${string}` // the page around the element has to do it; the package hands over what it needs
  | `gap: ${string}` // not met, and why
  | `n/a: ${string}` // does not arise for this AU
  | `lms: ${string}` // matched by the AU filter below, but a requirement on the LMS
  | 'umbrella' // met through the numbered requirements of its section

const ANSWERS: Record<string, Answer> = {
  '4.1.0.0-1': 'catapult: the LRS behind CATAPULT accepted every statement the run sent',
  '7.0.0.0-1': 'umbrella',
  '7.0.0.0-2': 'umbrella',
  '7.0.0.0-3': 'umbrella',
  '7.0.0.0-4': 'umbrella',
  '7.0.0.0-5': 'umbrella',
  '7.1.1.0-1': 'tested',
  '7.1.2.0-1': 'tested',
  '7.1.3.0-1': 'tested',
  '8.1.0.0-1': 'lms: the LMS launches by the course structure\'s launchMethod',
  '8.1.0.0-4': 'lms: the LMS appends the launch parameters',
  '8.1.0.0-5': 'lms: the LMS appends the launch parameters',
  '8.1.0.0-6': 'n/a: the only parameter of the AU\'s own is `src`, which none of the five is',
  '8.1.0.0-7': 'tested',
  '8.1.1.0-2': 'tested',
  '8.1.1.0-3': 'tested',
  '8.1.2.0-3': 'tested',
  '8.1.2.0-4': 'tested',
  '8.1.2.0-5': 'tested',
  '8.1.3.0-2': 'tested',
  '8.1.3.0-3': 'tested',
  '8.1.4.0-2': 'tested',
  '8.1.4.0-3': 'tested',
  '8.1.5.0-3': 'lms: the LMS generates the activityId',
  '8.1.5.0-5': 'tested',
  '8.1.5.0-6': 'tested',
  '8.2.1.0-2': 'tested',
  '8.2.1.0-5': 'tested',
  '8.2.2.0-4': 'tested',
  '8.2.2.0-5': 'tested',
  '9.1.0.0-1': 'tested',
  '9.3.0.0-1': 'umbrella',
  '9.3.2.0-2': 'tested',
  '9.3.2.0-3': 'tested',
  '9.3.3.0-1': 'tested',
  '9.3.3.0-2':
    'gap: kept once per launch, a reload included; a second launch of the same registration, after a completed one, sends it again. Knowing would take reading the LRS for the registration\'s statements at startup',
  '9.3.4.0-1': 'tested',
  '9.3.4.0-3': 'gap: as 9.3.3.0-2, once per launch rather than once per registration',
  '9.3.5.0-1': 'tested',
  '9.3.8.0-1': 'tested',
  '9.3.8.0-2': 'tested',
  '9.3.9.0-9': 'lms: the LMS sends satisfied',
  '9.4.0.0-2': 'tested',
  '9.5.1.0-1': 'tested',
  '9.5.1.0-3': 'tested',
  '9.5.4.1-1': 'tested',
  '9.5.4.1-2': 'tested',
  '9.5.4.1-3': 'tested',
  '9.5.4.1-4': 'tested',
  '9.5.4.2-2': 'tested',
  '9.6.3.1-4': 'tested',
  '9.6.3.2-2': 'tested',
  '10.1.0.0-1': 'lms: the LMS writes LMS.LaunchData',
  '10.1.0.0-3': 'lms: the LMS writes LMS.LaunchData',
  '10.1.0.0-4': 'lms: the LMS writes LMS.LaunchData',
  '10.1.0.0-5': 'lms: the LMS writes LMS.LaunchData',
  '10.2.1.0-4': 'tested',
  '10.2.1.0-5': 'tested',
  '10.2.1.0-6': 'tested',
  '10.2.1.0-7': 'tested',
  '10.2.2.0-1': 'tested',
  '10.2.2.0-2': 'tested',
  '10.2.2.0-3': 'tested',
  '10.2.2.0-5': 'umbrella',
  '10.2.2.0-6': 'tested',
  '10.2.2.0-7': 'tested',
  '10.2.2.0-8': 'tested',
  '10.2.2.0-9': 'tested',
  '10.2.2.0-10': 'tested',
  '10.2.2.0-11': 'tested',
  '10.2.4.0-2': 'tested',
  '10.2.6.0-1': 'tested',
  '11.0.0.0-1': 'tested',
  '11.0.0.0-2': 'n/a: the AU never writes the learner preferences',
  '11.0.0.0-3': 'tested',
  '11.2.0.0-1':
    'host: the element has no audio control of its own; the session and the initialized event carry learnerPreferences.audioPreference for the page to apply'
}

const requirements: Record<string, { txt: string }> = createRequire(import.meta.url)('@cmi5/requirements')

/**
 * The AU's requirements: the ones naming the AU, less the LMS's `(d)` derivatives and those
 * whose subject is the LMS ("the LMS MUST" with no "AU MUST" beside it).
 */
const onTheAu = Object.keys(requirements).filter((id) => {
  const text = requirements[id].txt
  if (id.includes('(d') || !/\b(AUs?|Assignable Unit)\b/.test(text)) return false
  return !/\bLMS MUST\b/.test(text) || /\b(AUs?|Assignable Unit) MUST\b/.test(text)
})

const testedText = readdirSync(import.meta.dirname)
  .filter((name) => name.endsWith('.test.ts') && name !== 'requirements.test.ts')
  .map((name) => readFileSync(resolve(import.meta.dirname, name), 'utf8'))
  .join('\n')

describe('the cmi5 requirements on the AU', () => {
  it('are each answered', () => {
    expect(onTheAu.filter((id) => !(id in ANSWERS))).toEqual([])
  })

  it('are real requirement numbers', () => {
    expect(Object.keys(ANSWERS).filter((id) => !(id in requirements))).toEqual([])
  })

  it('are named next to their test when marked tested', () => {
    const named = (id: string) => new RegExp(`(?<![\\d.])${id.replace(/\./g, '\\.')}(?![\\d-])`).test(testedText)
    expect(Object.keys(ANSWERS).filter((id) => ANSWERS[id] === 'tested' && !named(id))).toEqual([])
  })
})
