/**
 * The archives `build-fixtures.mjs` generates, and so the only ones it clears and the only ones
 * the demo build ships. `public/fixtures/` may hold real packages dropped in to try against the
 * dev server; those are neither wiped nor deployed.
 */
export const GENERATED_FIXTURES = [
  'basic.h5p',
  'large-deflated.h5p',
  'large-stored.h5p',
  'segmented.h5p',
  'streamed.h5p',
  'traversal.h5p',
  'not-h5p.h5p',
  'content-only.h5p',
  'needs-libraries.h5p',
  'libraries.h5p',
  'unversioned.h5p',
  'corrupt.h5p'
]
