# Which build a learner completed

Every `xapi` and `finished` statement carries two xAPI fields, filled in unless the content set
them itself:

```json
"context": {
  "revision": "sha256:500da158…",
  "platform": "h5p-offline-player 0.1.10"
}
```

`revision` is a SHA-256 over the archive's index — each file's name, sizes and CRC — so any
change to the package gives a new value and the same file always gives the same one. When
`libraries` supplied the libraries, the bundle's follows: `sha256:…; libraries sha256:…`. The
element's `revision` property holds it once the package is indexed.

**At release**, record it: the normalizer prints the revision of the file it writes. Keep the
published `.h5p`, from which anyone can recompute it.

It identifies a build; it does not seal one, since a CRC can be forged on purpose. It also cannot
say *when* a build was current — that belongs in your LMS, LRS or document control, against which
an audit compares each statement's `revision` and timestamp. For a major change, publish at a new
URL, which gives a new xAPI activity id unless `activity-id` names one.
