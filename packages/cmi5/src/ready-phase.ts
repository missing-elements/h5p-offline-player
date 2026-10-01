export interface BufferedEvents<Statement, Outcome> {
  statements: Statement[]
  outcome: Outcome | null
}

/** Buffers player events until cmi5 has sent initialized, then stops accepting them on teardown. */
export class ReadyPhase<Statement, Outcome> {
  #phase: 'handshaking' | 'ready' | 'stopped' = 'handshaking'
  #statements: Statement[] = []
  #outcome: Outcome | null = null

  statement(statement: Statement): Statement | null {
    if (this.#phase === 'stopped') return null
    if (this.#phase === 'ready') return statement
    this.#statements.push(statement)
    return null
  }

  outcome(outcome: Outcome): Outcome | null {
    if (this.#phase === 'stopped') return null
    if (this.#phase === 'ready') return outcome
    this.#outcome = outcome
    return null
  }

  ready(): BufferedEvents<Statement, Outcome> {
    if (this.#phase !== 'handshaking') return { statements: [], outcome: null }
    this.#phase = 'ready'
    const events = { statements: this.#statements, outcome: this.#outcome }
    this.#statements = []
    this.#outcome = null
    return events
  }

  stop(): void {
    this.#phase = 'stopped'
    this.#statements = []
    this.#outcome = null
  }
}