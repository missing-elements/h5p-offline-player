# Which build a learner completed

Every xAPI statement the player emits names the build of the package it came from. This is how,
what the value means, and what it does not claim.

Every `xapi` and `finished` statement leaves with two fields xAPI defines for exactly this,
filled in when the content has not set them itself:

```json
"context": {
  "revision": "sha256:500da158…",
  "platform": "h5p-offline-player 0.1.10"
}
```

`revision` identifies the build: a SHA-256 over the archive's index — every file's name, size
and checksum — so any change to the package gives a new one, and replaying the same file gives
the same one. When `libraries` supplied the libraries, their bundle's follows:
`sha256:…; libraries sha256:…`. The element's `revision` property has the same value once the
package is indexed. It is a build identifier, not a forgery-proof seal: keep the published
`.h5p`, and anyone can recompute it. The normalizer prints it for the file it writes, which is
the line to put in your version record at release.

*When* a build was the current one is not something a statement or a package can say — a package
cannot know it will be replaced. That is your version record: your LMS or LRS, or the document
control you already run. An audit compares each statement's `revision` and timestamp against it.
For a major change, publish at a new URL, which also gives the content a new xAPI activity id — the
package URL is the activity by default, unless the element's `activity-id` names one.

On a host without `Range` the content can start before the download has finished, when the
index is not known yet; statements sent in that window are held and released, in order, with
their revision, once it is — or at once, without it, if the page is hidden first, so a learner's
record never goes down with the tab.
