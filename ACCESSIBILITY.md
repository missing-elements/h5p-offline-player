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
  how that reaches the learner; put it in an element with `role="alert"` or `aria-live`.

## What a host page should do

- Give the player a heading or label nearby that says what the content is.
- Show `error` messages in a live region, and do not hide the player on a `runtime` error
  after `ready`: the content is still running.
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

## Not checked yet

- A real screen reader: NVDA or JAWS on Windows, VoiceOver on macOS and iOS. The run above
  checks names and roles as the browser exposes them, which is necessary, not sufficient.
- Firefox and Safari.
- Zoom to 400% and reflow, colour contrast, reduced motion.
- Captions and transcripts, which are the content author's to add in the content type.

Found something? Open an issue with the package (or the content type and its version), the
browser and the assistive technology, and what happened.
