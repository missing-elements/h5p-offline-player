# Review of suggested features, 2026-09-30

Eight suggestions arrived in one note, grouped as audit trail, accessibility and enterprise
integration. This is each one against the code as it is: what already exists, what the
suggestion gets wrong about the design, and what, if anything, is worth building. The short
version is at the end.

## 1. Audit trail and content versioning

### In-browser SHA-256 of the raw file — built differently, on purpose

The player already stamps a SHA-256 on every statement, as `revision` (see `revision.md`). It
is not a hash of the whole file, and cannot be: on a host that honours `Range`, the player
reads the index and the entries the content asks for, and the rest of a 300 MB package never
crosses the network. Hashing the whole file would mean downloading it whole, which is the thing
the player exists to avoid. The hash is over the archive's central directory instead — every
entry's name, sizes, CRC-32 and method, in order — which is read on every load anyway. Any
change to the package changes it, and the same file gives the same value from a URL, from disk
and from the offline app, which a hash that depended on how the file arrived would not.

What it is not: a seal. CRC-32 can be forged on purpose, so `revision` identifies a build and
the kept `.h5p` is what an audit recomputes it from. The normalizer prints the value for the
file it writes, which is the line for a release record. Nothing to build.

### Injecting the hash into xAPI context — built, in the standard field

Every `xapi` and `finished` statement leaves with `context.revision` and `context.platform`
filled in. The note proposes a `context.extensions` entry under a project IRI; that was the
first plan here and was rejected. `revision` is the field xAPI defines for exactly this and every
LRS and reporting tool reads it; an extension IRI means nothing to any tool without a profile
document behind it, and the domain in the example is not one this project owns.

The hook in the example, `player.onXAPIStatement(callback)`, exists as the `xapi` event. The
host does the sending, so a listener that changes `event.detail.statement` before sending it
has already done what the example shows. Nothing to build.

### Version strings in a config the player attaches to records — not the player's job

A `version: "1.0.4"` or `complianceId` is something the *organisation* knows about a package,
and a host adds it in the same listener, one line per field. Reading it from the package
instead has no home: `h5p.json` has no field for it, H5P editors regenerate that file on export,
and a custom key survives only as long as nobody re-exports. The design note in `AGENTS.md`
records the same conclusion from a different angle: *when* a build was current is the LMS's or
document control's record, not the package's. Not building it; a five-line host example in
`revision.md` would answer the request if it comes again.

## 2. Accessibility safeguards

### Focus trap prevention — built and checked

The frame is a same-origin iframe with no wrapper that takes focus, so Tab enters the content
and leaves it natively. `ACCESSIBILITY.md` records a keyboard-only run over seven content types
with no trap found. What is missing is a test that pins it, so a future change to the shadow
tree cannot reintroduce one silently. Worth adding to the browser suite: Tab from a control
before the element, through the content, to a control after it, and Shift+Tab back.

### ARIA attributes on the iframe — the useful part is built, the rest is a mistake

The frame carries a `title`, which is what assistive technology reads for an iframe, and since
0.1.10 it is the package's own title from `h5p.json`. `role="application"` on the frame is the
wrong advice: it switches screen readers out of browse mode for everything inside, which is
precisely what H5P content, built from ordinary buttons and headings, does not want. Skip it.

One small thing is not built: a host cannot override the frame title, since the iframe is in
the shadow tree. A `frame-title` attribute is ten lines. Worth doing when a host asks for it.

### An accessibility linter keyed on content types — the premise is wrong, the tool is right

A hard-coded list of "inaccessible" content types would be wrong on the day it was written.
Accessibility in H5P is per library version, not per content type: the two examples in the
note have keyboard and screen-reader support in their current versions and lacked it in older
ones, and the same package can carry either. H5P's own recommendations page is the reference
and it changes. A warning flag built on a list would be false, then stale.

What fits the CI/CD purpose is a *report*, without judgement: the verifier lists the content
types and library versions a package uses, beside a link to H5P's recommendations page, so an
organisation checks them against the versions it has cleared. `AGENTS.md` lists a "content
digest" among the things the verifier deliberately does not do yet; this is the reason to do
it. Cheap: `h5p.json`'s `preloadedDependencies` names them all.

## 3. Enterprise integration

### An offline statement queue — a real need, in the wrong layer

The element promises that statements are never stored, and `resume` was built so that promise
still holds (only the content's state is kept, and only when asked). A queue inside the element
breaks it. The need is real all the same: the installable app plays packages with no network
and today its statements go nowhere.

The right place is beside the element, as host code: an IndexedDB queue keyed by statement id,
flushed on `online` and on open, with the LRS endpoint and credentials the app does not have a
setting for yet. About a hundred lines, in the app or as a small package of its own. Worth
building when the app gets an LRS setting; without one there is nothing to flush to.

### cmi5 — a wrapper page, not a player change

The player is the content half of a cmi5 assignable unit. What cmi5 needs is on the page around
it: reading `endpoint`, `fetch`, `actor`, `registration` and `activityId` from the launch URL,
posting to `fetch` for the token, fetching the `LMS.LaunchData` state document for the context
template and the learner preferences, sending `initialized`, wrapping H5P's statements as
"allowed" statements with that template, turning `finished` into `completed` or
`passed`/`failed` under the launch data's `moveOn` and `masteryScore`, and sending `terminated`
on Exit. The element already gives a page everything it needs for that: `xapi`, `finished` with
the score, and `revision`.

Built on 2026-10-01 as that, not as a change to the element: the package
[`@missing-elements/h5p-cmi5`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/cmi5)
and the demo's `/demo/cmi5.html` on it, checked against ADL's CATAPULT player and launched from
SCORM Cloud; [docs/cmi5.md](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md)
is the guide. One thing this note had wrong: `terminated` is not sent on unload. A page cannot
tell a reload from a closed tab, and a `terminated` on a reload ends the session the reloaded
page goes on using; a tab closed without Exit is the LMS's to record as `abandoned`.

## In short

| Suggestion | Status | Do |
|---|---|---|
| SHA-256 of the file | built, as `revision` over the index | nothing |
| Hash in xAPI context | built, as `context.revision` | nothing |
| Version strings from a package config | host's one-liner | a host example, if asked |
| Focus trap prevention | built and checked by hand | a browser test |
| ARIA on the frame | `title` built; `role="application"` is wrong | `frame-title` attribute, if asked |
| Accessibility linter | premise wrong | the verifier lists content types and versions |
| Offline statement queue | not built; not for the element | in the app, once it has an LRS setting |
| cmi5 | built, as `@missing-elements/h5p-cmi5` and a demo page | nothing |

Of the three directions the note asks about, the one that fits the codebase now is the
verifier's content digest: it serves the same CI/CD audience, it is small, and it makes no
claim the player cannot back. The offline queue is second, and waits on an LRS setting in the
app. Content versioning is done.
