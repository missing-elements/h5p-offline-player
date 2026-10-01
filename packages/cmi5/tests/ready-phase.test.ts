import { describe, expect, it } from 'vitest'
import { ReadyPhase } from '../src/ready-phase.js'

describe('ReadyPhase', () => {
  it('buffers events through the handshake, then passes through and stops cleanly', () => {
    const phase = new ReadyPhase<string, number>()

    expect(phase.statement('first')).toBeNull()
    expect(phase.outcome(1)).toBeNull()
    expect(phase.statement('second')).toBeNull()
    expect(phase.ready()).toEqual({ statements: ['first', 'second'], outcome: 1 })
    expect(phase.statement('later')).toBe('later')
    expect(phase.outcome(2)).toBe(2)

    phase.stop()
    expect(phase.statement('ignored')).toBeNull()
    expect(phase.outcome(3)).toBeNull()
    expect(phase.ready()).toEqual({ statements: [], outcome: null })
  })
})