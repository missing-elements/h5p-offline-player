// The repository's star count on the header's Star button. A classic script in <head>, like
// theme.js and for the same reason: the count a visitor was last shown is put on <html> before
// anything is painted — as `data-stars`, and as `--star-count`, a CSS string the stylesheet draws
// after the star — so moving between pages draws the button whole, where a module, run after the
// first paint, made it grow under the reader on every page.
//
// The count comes from GitHub's API in the visitor's browser, which `connect-src 'self' https:`
// allows, at most once an hour: the API answers sixty unauthenticated requests an hour per address,
// and a school or an office is one address. What is stored is when to ask next, written before
// asking, so the pages opened while a request is out do not ask too: an hour after a success, ten
// minutes after a failure, and after a rate limit the moment GitHub says it lifts
// (`X-RateLimit-Reset`, which it exposes to pages). The first cut stored when it last asked and
// waited an hour after any failure, so a visitor rate-limited at 09:25 by a limit lifting at 09:40
// saw no count until 10:25. The count already shown stays through a failure; with none ever
// fetched, the button shows none. In an installed window of the app the button is
// not shown at all (app.css), so nothing is drawn and nothing asked: an app meant to work offline
// should not reach a third party for a button it hides.
;(() => {
  if (matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches) return

  const API = 'https://api.github.com/repos/missing-elements/h5p-offline-player'
  const KEY = 'h5p-demo-stars'
  const FRESH_MS = 60 * 60 * 1000
  const RETRY_MS = 10 * 60 * 1000
  const root = document.documentElement
  const format = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

  const stored = () => {
    try {
      // A record without `next` is the first cut's, which could hold a visitor back for an hour
      // after a limit had lifted: it counts as nothing, and the page asks again.
      const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null')
      return kept && typeof kept.next === 'number' ? kept : null
    } catch {
      return null
    }
  }
  const store = (kept) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(kept))
    } catch {
      // No storage: the next page asks again.
    }
  }

  // The label says the count too, since the drawn one is generated content the label replaces.
  const label = () => {
    const count = Number(root.dataset.stars)
    if (!Number.isInteger(count)) return
    for (const button of document.querySelectorAll('.star-button')) {
      button.setAttribute('aria-label', `Star on GitHub, ${count} ${count === 1 ? 'star' : 'stars'}`)
    }
  }
  const show = (count) => {
    root.dataset.stars = String(count)
    root.style.setProperty('--star-count', JSON.stringify(format.format(count)))
    label()
  }

  const kept = stored()
  if (Number.isInteger(kept?.count)) show(kept.count)
  addEventListener('DOMContentLoaded', label)

  if (kept && Date.now() < kept.next) return
  const last = kept?.count ?? null
  store({ count: last, next: Date.now() + RETRY_MS })
  fetch(API, { referrerPolicy: 'no-referrer' })
    .then((response) => {
      if (response.ok) return response.json()
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
      if (reset > Date.now()) store({ count: last, next: reset })
      return null
    })
    .then((repository) => {
      const count = repository?.stargazers_count
      if (!Number.isInteger(count)) return
      store({ count, next: Date.now() + FRESH_MS })
      show(count)
    })
    .catch(() => {})
})()
