// `@xapi/cmi5` ships only a browser ESM build, which Node cannot resolve. The module loads it
// lazily, for a real launch, and the tests always pass a client of their own, so this stands in
// for the name and fails loudly if a test ever reaches it.
export default class Cmi5 {
  constructor() {
    throw new Error('the tests pass their own client; @xapi/cmi5 is for a browser')
  }
}
