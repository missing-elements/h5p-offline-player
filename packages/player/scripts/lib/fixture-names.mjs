/**
 * The archives `build-fixtures.mjs` generates, and so the only ones it clears and the only ones
 * the demo build ships. `public/fixtures/` may hold real packages dropped in to try against the
 * dev server; those are neither wiped nor deployed.
 */
/** The size of the large media entry in the large fixtures: enough to take the slice and chunk paths. */
export const LARGE_ENTRY_SIZE = 20 * 1024 * 1024

export const GENERATED_FIXTURES = [
  'basic.h5p',
  'german.h5p',
  'english.h5p',
  'german-late-manifest.h5p',
  'finished.h5p',
  'large-deflated.h5p',
  'large-stored.h5p',
  'segmented.h5p',
  'streamed.h5p',
  'traversal.h5p',
  'not-h5p.h5p',
  'content-only.h5p',
  'needs-libraries.h5p',
  'libraries.h5p',
  'untrusted.h5p',
  'untrusted-newer.h5p',
  'older-own.h5p',
  'needs-dependency.h5p',
  'untrusted-markup.h5p',
  'libraries-without-semantics.h5p',
  'upgrade-libraries.h5p',
  'upgrade-1.0.h5p',
  'upgrade-1.1.h5p',
  'upgrade-1.2.h5p',
  'upgrade-fails.h5p',
  'upgrade-1.3.h5p',
  'newer-child.h5p',
  'unversioned.h5p',
  'unversioned-pack.h5p',
  'corrupt.h5p',
  'html-page.h5p'
]
