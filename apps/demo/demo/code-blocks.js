/*
 * The code blocks' tabs and copy buttons. The blocks are highlighted when the page is built
 * (scripts/lib/code-blocks.mjs), the first tab already selected, so this only adds what needs a
 * click.
 *
 * A tab is one choice for the whole site: pnpm picked in one block is picked in every block that
 * offers it, on this page and on the next one, remembered in this browser.
 */

const STORAGE_KEY = 'h5p-demo-code-tab'
/** @type {WeakMap<HTMLElement, number>} */
const resets = new WeakMap()

function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function remember(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    // Storage refused (a private window, blocked site data): the choice lasts for this page.
  }
}

/** Selects the tab named `name` in one block, if it has one. */
function select(block, name) {
  const tabs = [...block.querySelectorAll('[role="tab"]')]
  if (!tabs.some((tab) => tab.dataset.tab === name)) return
  for (const tab of tabs) {
    const selected = tab.dataset.tab === name
    tab.setAttribute('aria-selected', String(selected))
    tab.tabIndex = selected ? 0 : -1
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected
  }
}

function selectEverywhere(name) {
  for (const block of document.querySelectorAll('.code-block[data-tabs]')) select(block, name)
  remember(name)
}

function say(button, text) {
  const status = button.parentElement.querySelector('.code-status')
  button.textContent = text
  status.textContent = text
  clearTimeout(resets.get(button))
  resets.set(
    button,
    setTimeout(() => {
      button.textContent = 'Copy'
      status.textContent = ''
    }, 2000)
  )
}

async function copy(button) {
  const code = [...button.closest('.code-block').querySelectorAll('.code-body')].find((panel) => !panel.hidden)
  try {
    await navigator.clipboard.writeText(code.textContent)
    say(button, 'Copied')
  } catch {
    // No clipboard here (a refused permission, an embedding frame that does not allow it): the
    // code is selected instead, for the keyboard's copy.
    getSelection()?.selectAllChildren(code)
    say(button, 'Selected')
  }
}

const saved = remembered()
if (saved) for (const block of document.querySelectorAll('.code-block[data-tabs]')) select(block, saved)

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null
  const tab = target?.closest('.code-block [role="tab"]')
  if (tab) return selectEverywhere(tab.dataset.tab)
  const button = target?.closest('.code-copy')
  if (button) copy(button)
})

// Arrow keys, Home and End move between tabs, as the ARIA tabs pattern has it; Tab leaves the
// list for the panel.
document.addEventListener('keydown', (event) => {
  const tab = event.target instanceof Element ? event.target.closest('.code-block [role="tab"]') : null
  if (!tab) return
  const tabs = [...tab.parentElement.querySelectorAll('[role="tab"]')]
  const index = tabs.indexOf(tab)
  const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key]
  if (to === undefined) return
  event.preventDefault()
  const next = tabs[(to + tabs.length) % tabs.length]
  selectEverywhere(next.dataset.tab)
  next.focus()
})
