import { ContentGenerator, librariesIn, libraryString } from '@missing-elements/h5p-author'

/**
 * The sweep's way of running the content generator, which is @missing-elements/h5p-author's (one
 * copy since 2026-11-01, #100): lenient, taking what `apps/demo/sweep/<machineName>.json` writes as
 * it is, and filling every required field the semantics give no default for with the smallest
 * value the content check accepts — a label as text, the first sample a pattern accepts, the
 * minimum number, the first option, the sample image, video or audio, the first sub-content the
 * pack has. Authoring refuses such a field instead; the sweep has to make every content type play.
 *
 * Deterministic: sub-content ids are numbered, so generated packages are the same bytes every run.
 * `tests/sweep-content.test.ts` holds the sweep's rules; the generator's own are the package's.
 */

export { ContentGenerator, librariesIn, libraryString }

/** The files a generated value may point at, under `content/`, and what each one is. */
export const MEDIA = {
  image: { path: 'images/sample.png', mime: 'image/png', width: 640, height: 360 },
  video: { path: 'videos/sample.mp4', mime: 'video/mp4' },
  audio: { path: 'audios/sample.wav', mime: 'audio/wav' },
  file: { path: 'files/sample.txt', mime: 'text/plain' }
}

/**
 * Text tried, in order, for a required field whose semantics give a pattern and no default: the
 * first that matches is used. Covers every pattern in the pack on 2026-10-14 — colours, dates,
 * times, coordinates, sizes, an address, a phone number, a URL.
 */
const PATTERNED_SAMPLES = ['Sample', '#808080', 'https://example.org/', 'sample@example.org', '+1 555 0100', '2026/1/1', '12:00', '2026,1,1', '100px', '0', 'a']

/** @type {import('@missing-elements/h5p-author').GeneratorOptions} */
export const sweepOptions = {
  lenient: true,
  id: (count) => `00000000-0000-4000-8000-${count.toString(16).padStart(12, '0')}`,
  fill(field, { generator, stack }) {
    switch (field.type) {
      case 'library':
        return generator.library(field, stack)
      case 'text':
        return sampleText(field)
      case 'number':
        return Math.max(field.min ?? 0, Math.min(field.max ?? Infinity, 1))
      case 'select':
        return field.options?.length ? field.options[0].value : undefined
      case 'image':
      case 'file':
        return { ...MEDIA[field.type], copyright: { license: 'U' } }
      case 'video':
      case 'audio':
        return [{ path: MEDIA[field.type].path, mime: MEDIA[field.type].mime, copyright: { license: 'U' } }]
      default:
        return undefined
    }
  }
}

/** The sample files the parameters point at, by kind. */
export function mediaIn(params) {
  const text = JSON.stringify(params)
  return /** @type {(keyof typeof MEDIA)[]} */ (Object.keys(MEDIA)).filter((kind) => text.includes(`"${MEDIA[kind].path}"`))
}

/**
 * Text for a required field: its label, as an editor would show it, as markup for an HTML
 * field, or the first sample its pattern accepts.
 * @param {any} field
 */
function sampleText(field) {
  if (field.regexp?.pattern) {
    const pattern = new RegExp(field.regexp.pattern, field.regexp.modifiers ?? '')
    return PATTERNED_SAMPLES.find((candidate) => pattern.test(candidate)) ?? ''
  }
  const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : 'Sample'
  const text = field.maxLength ? label.slice(0, field.maxLength) : label
  return field.widget === 'html' ? `<p>${escapeHtml(text)}</p>` : text
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
}
