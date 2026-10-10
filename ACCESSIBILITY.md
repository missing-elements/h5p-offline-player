# Accessibility

Section 508, EN 301 549 and WCAG conformance is judged on what a learner meets: the page, the
player and the H5P content type together. This page says which part is whose, and what a
keyboard-only run found.

## Who is responsible for what

| Part | What it covers | Whose |
|---|---|---|
| The host page | headings, landmarks, where the player sits, how errors are shown | yours |
| The player (`<h5p-player>`) | one iframe and no controls of its own: whether focus can get into the content and out again, the frame's accessible name, fullscreen, how failures are reported | this project |
| The content type | every control, label, focus order, keyboard interaction, live region, caption and colour inside the frame | H5P, per content type and **per library version** |

The player does not change the content's markup: it serves the files in the package to the
H5P runtime unmodified. A content type behaves the same here as it does on h5p.com, Moodle or
WordPress with the same library version. H5P's own
[accessibility report](https://h5p.com/pdfs/h5p-vpat-april-2026.pdf) and
[content-type recommendations](https://help.h5p.com/hc/en-us/articles/7505649072797-Content-types-recommendations)
are the reference for that part. They cover the content types upgraded to H5P's new look and
feel, not their legacy versions, so which one a learner gets depends on the library versions
inside the package.

## What the player does

- **No focus trap.** Tab moves from the page into the content and out to the next element on
  the page; Shift+Tab does the same in reverse. Checked for every package below.
- **The frame is named after the package.** A screen reader announces the frame by the title
  in the package's `h5p.json`, and by "H5P content" before a package has loaded or when it has
  no title. From 0.1.10; up to 0.1.9 every frame was "H5P content".
- **Fullscreen works from the keyboard.** The content type's Fullscreen button enters it, its
  Exit fullscreen button leaves it, and focus comes back to the Fullscreen button.
- **Failures are events, not messages.** The element renders nothing when a package fails; it
  fires `error` with a sentence written for a person in `detail.message`. The host page decides
  how that reaches the learner: put it into a live region (`role="status"` or `role="alert"`)
  that is already on the page, empty. A region that appears together with its text is announced
  by some screen readers and not by others.

## What a host page should do

- Give the player a heading or label nearby that says what the content is.
- Show `error` messages in a live region that is on the page from the start, and do not hide
  the player on an `error` while `state` stays `ready`: the content is still running.
- Do not set `tabindex="-1"` on the element or wrap it in something that takes focus.
- Prefer packages built with current library versions; see *Who is responsible*.

## Keyboard-only run, 2026-09-29

Chromium, keyboard only, on the demo site's player page. Each package was opened, then Tab was
pressed from the URL field through the content and out, and Shift+Tab back. Each stop was
checked for an accessible name, a visible focus indicator and a size on screen. Then one task
per package was done with keys alone.

| Package (library version) | Focus in and out | Task done with the keyboard | Notes |
|---|---|---|---|
| Question Set 1.20 | yes | start, answer, check; `answered` sent | |
| Interactive Video 1.27 | yes | Enter on the splash plays; focus moves to Pause | one tab stop after the progress bar has no name and no size |
| Accordion 1.0 | yes | Enter opens a panel, Space closes it | focus shown by a border rather than an outline |
| Dialog Cards 1.9 | yes | Turn and Next reachable | |
| Course Presentation 1.27 | yes | Next slide, answer, check; `answered` sent | one link stop with no name; after Next slide focus stays on the navigation, and the slide's controls come before it (Shift+Tab) |
| Interactive Book 1.15 | yes | Next page reaches chapter two | |
| Drag and Drop 1.15 | yes | Space picks an item up, arrow keys choose a zone, Space drops; the next item is reached with arrow keys, not Tab; check; `answered` sent | only one item is a Tab stop at a time, by design; a learner needs to know about the arrow keys |

The four demo packages use the H5P hub's current versions; Course Presentation, Interactive
Book and Drag and Drop were built with h5p-cli from the libraries' GitHub repositories, which
are newer than the hub's. Drag and Drop and Course Presentation were also run in h5p-cli's own
viewer, which embeds H5P the usual way, and behaved the same there. None of the notes above
comes from the player: they are in the content types' own markup, which the player serves
unchanged.

## Firefox and WebKit, 2026-10-02

The same seven packages and the same passes, with the scripts of the Chromium run, in
Playwright's Firefox and WebKit builds on macOS, headless, against the built demo site under its
production headers. WebKit is Safari's engine, not Safari: what it shows is how the engine moves
focus, not how Safari's own settings or VoiceOver behave.

| Package | Firefox | WebKit (Option+Tab) |
|---|---|---|
| Question Set | in and out; start, answer, check; `answered` sent | the same |
| Interactive Video | in and out; Enter on the splash plays, focus moves to Pause | the same |
| Accordion | in and out; Enter opens a panel, Space closes it | the same |
| Dialog Cards | in and out; Turn and Next reachable | the same |
| Course Presentation | in and out; Next slide, answer, check; `answered` sent | the same |
| Interactive Book | in and out; Next page reaches chapter two | the same |
| Drag and Drop | in and out; both items placed with Space and the arrow keys; check; `answered` sent | the same |

No focus trap in either engine, forward or back, and the frame is announced by the package's
title in both. The tab stops are those of the Chromium run, with three differences, none of them
the player's:

- **Safari's Tab skips buttons and links by default.** With macOS's "Keyboard navigation" off —
  the default — Tab in Safari moves only between text fields and a few other controls, and
  Option+Tab moves through everything; the WebKit run above used Option+Tab. With plain Tab, a
  learner reaches only the controls of the content that are not `<button>` or `<a>` elements,
  and focus goes from the content past the page's links. This is a Safari setting, the same on
  every site, and the learner's to change (System Settings → Keyboard → Keyboard navigation, or
  Safari's "Press Tab to highlight each item"). A page aimed at keyboard users on Macs may want
  to say so.
- **Firefox gives the frame's document a tab stop of its own** before the first control, and
  makes two more things focusable that the other engines do not: Interactive Video's `<video>`
  element, which has no name, and a scrollable text box in Course Presentation, which shows no
  focus outline. Both are Firefox's rules for media and scrolling containers.
- **Option groups are one tab stop, chosen with the arrow keys**, in Course Presentation's
  question as in Drag and Drop; the stop lands on the last option coming back with Shift+Tab.
  The same in all three engines, and by design, but a learner needs to know about the arrow keys.

## Not checked yet

- A real screen reader: NVDA or JAWS on Windows, VoiceOver on macOS and iOS. The runs above
  check names and roles as the browser exposes them, which is necessary, not sufficient.
- Safari itself, and Safari on iOS, with VoiceOver; Firefox and Chromium on Windows.
- Zoom to 400% and reflow, colour contrast, reduced motion.
- Captions and transcripts, which are the content author's to add in the content type.

Found something? Open an issue with the package (or the content type and its version), the
browser and the assistive technology, and what happened.
