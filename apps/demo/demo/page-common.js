/**
 * What the demo's pages share. The player page, the cmi5 page and the installable app each show
 * a message, keep a log, decide whether a package comes from another site and ask before playing
 * one with its own code; each once carried its own copy, and a fix to the trust decision reached
 * one page in three.
 */

/** How much of a page's log is kept, newest first. */
const LOG_LIMIT = 20_000

/** `show(text, kind)` for a page's message box: `hint` or `error`; empty text hides it. */
export const messageIn = (message) => (text, kind = 'hint') => {
  message.textContent = text
  message.className = `message ${kind}`
  message.hidden = !text
}

/** `write(line)` for a page's log: stamped, newest first, cut at `LOG_LIMIT`. */
export const logInto = (log) => (line) => {
  const stamp = new Date().toLocaleTimeString([], { hour12: false })
  log.textContent = `${stamp}  ${line}\n${log.textContent}`.slice(0, LOG_LIMIT)
}

/**
 * The host of a package on another site, or `null` for this site's own and for what is not a URL
 * (which the caller then reports). A package's libraries are JavaScript and the frame is
 * same-origin by design, so a package's own code runs with this origin's storage — with `resume`
 * on, the saved state of every file opened here, answers included, and the chunk store and the
 * list of what was played. A file the visitor picked, or an address they typed, is their choice;
 * a link's `?src=` is whoever wrote the link's, so one on another site plays `untrusted`, as
 * data, with the site's own libraries and none of its own, and asks for a click that names the
 * host only when it cannot play without its own code.
 */
export const foreignHost = (src) => {
  try {
    const url = new URL(src, location.href)
    // A `data:` URL has no host and an opaque origin: name its scheme, so it counts as another site's.
    return url.origin === location.origin ? null : url.host || url.protocol
  } catch {
    return null
  }
}

/**
 * The question before a package from another site plays with its own code. `ask(host, go)` shows
 * the box naming the host and runs `go` on the one click; a later `ask` replaces what was
 * pending, and `dismiss()` hides the box for a load that makes the question moot. One listener,
 * however often it is asked.
 */
export const trustPrompt = (confirmBox, confirmButton) => {
  let pending = null
  confirmButton.addEventListener('click', () => {
    confirmBox.hidden = true
    const go = pending
    pending = null
    go?.()
  })
  return {
    ask(host, go) {
      confirmBox.querySelector('.host').textContent = host
      confirmBox.hidden = false
      pending = go
    },
    dismiss() {
      confirmBox.hidden = true
      pending = null
    }
  }
}
