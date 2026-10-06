// The site's light/dark switch. A classic script, not a module, linked in <head> ahead of the
// stylesheet: it has to put a pinned theme on <html> before anything is painted, or a visitor who
// pinned the opposite of their system setting sees every page flash the wrong way as it loads.
// The CSP allows no inline script, so it is a file, linked with `vite-ignore` and copied by the
// build as it is. Without it — blocked, or not yet run — the stylesheet follows the system
// setting on its own, which is also what it does with no pin.
//
// Two states, not three: following the system, or pinned to the other theme. A press pins the
// theme the visitor is not seeing; a press that would pin the system's own theme clears the pin
// instead, so the page follows the system again and a pin never outlives its point.
;(() => {
  const KEY = 'theme'
  const root = document.documentElement
  const system = matchMedia('(prefers-color-scheme: dark)')

  const stored = () => {
    try {
      const value = localStorage.getItem(KEY)
      return value === 'light' || value === 'dark' ? value : null
    } catch {
      return null
    }
  }
  const show = (pin) => {
    if (pin) root.dataset.theme = pin
    else delete root.dataset.theme
  }
  const shown = () => root.dataset.theme || (system.matches ? 'dark' : 'light')

  show(stored())

  addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('.theme-toggle')
    if (!button) return

    // The label names what a press does, which is the one thing an icon cannot say.
    const describe = () => {
      const text = `Switch to the ${shown() === 'dark' ? 'light' : 'dark'} theme`
      button.setAttribute('aria-label', text)
      button.title = text
    }

    button.addEventListener('click', () => {
      const next = shown() === 'dark' ? 'light' : 'dark'
      const pin = next === (system.matches ? 'dark' : 'light') ? null : next
      show(pin)
      try {
        if (pin) localStorage.setItem(KEY, pin)
        else localStorage.removeItem(KEY)
      } catch {
        // No storage: the choice holds for this page and no longer.
      }
      describe()
    })

    // The system setting can change under a page that follows it, and another tab can change
    // the pin; the stylesheet follows both by itself, the label and the icon follow here.
    system.addEventListener('change', describe)
    addEventListener('storage', (event) => {
      if (event.key !== KEY && event.key !== null) return
      show(stored())
      describe()
    })

    describe()
  })
})()
