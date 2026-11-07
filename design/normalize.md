# The normalizer

`pnpm normalize course.h5p` rewrites a package once so that it streams. It is the fix for
the deflated, non-faststart video above, applied where it belongs — to the package, by whoever
publishes it. It is its own package, `packages/normalize`, published as
`@missing-elements/h5p-normalize` so that a publisher runs it with `npx` and needs no checkout:
`lib/normalize.mjs` holds the policy, `lib/mp4-faststart.mjs` the remux and `lib/zip-writer.mjs`
the output side; `bin/h5p-normalize.mjs` is the command. Its documented API is `normalizeArchive`,
with `formatBytes` and `archiveFingerprint` re-exported, so the other modules stay free to change;
the demo's content build and h5p-author's Node build are the callers in this repository. Its
`prepublishOnly` runs its typecheck and tests, and its `prepack` copies the root LICENSE in. Five
things about it that the code does not say by itself:

- **It writes the zip itself.** zip.js reads the input — descriptors, zip64, inflate, all
  handled — but its `ZipWriter`, asked not to write a data descriptor, buffers the whole entry
  until it knows the sizes (`!dataDescriptor && !emptyEntry` takes the buffered path in
  `zip-writer.js`). The normalizer always knows them — stored bytes the source measured, or bytes
  it has counted itself — so `StreamingZipWriter` puts a complete local header in front of each
  entry and never buffers. No descriptors also means the forward scanner reads an entry's size
  off its header instead of hunting for a descriptor signature through 200 MB of video.
- **Faststart is a remux, not a re-encode.** Only the `stco`/`co64` chunk offset tables inside
  `moov` change, by `moov`'s own length, and only for positions that lay between `mdat` and
  `moov`; an atom after `moov` keeps its position. Anything the walker does not understand — a
  fragmented file, a compressed `cmov`, an offset that would outgrow `stco` — is left exactly as
  it was. A deflated mp4 is inflated to a temp file first, because `moov` is at the end and a
  deflate stream cannot be seeked; a stored one is read in place in the source archive.
- **Library folders stay whole; only `content/` media moves to the end.** The forward index
  treats a folder as finished once a later folder has begun, so a library's own png pulled to the
  end would be reported absent after its library had "arrived". A caller can also name folders to
  write after the media, `last` (2026-11-06, #148): libraries a package carries and nothing reads
  as it plays, which h5p-author and the demo's packages carry for an H5P site's upload check
  (#146) and which sorted before `content.json` like any library, so that a host that ignores
  `Range` had them to wait for. h5p-author's Node build and the demo's content script pass them.
  Only the caller knows which they are, so the command has no flag and the normalizer reads no
  `library.json`; `content` is never moved and a name the archive lacks is ignored. Measured on
  the demo's video with them (Interactive Video, 5.2 MB, its content ending at 4.1 MB in the
  library order and at 1.5 with `last`) from a host paced to 1 MB/s that ignores `Range`: ready
  at 2.3 s with 2.3 MB sent, where it was 4.5 s with 4.4 MB. A host that honours `Range` gains
  nothing from the order: the player's warm leaves out what `h5p.json` does not declare,
  wherever it lies (*the libraries `h5p.json` declares are pulled whole* in serving.md), and the
  same video is ready there at 1.9 s in either layout.
- **It drops what the player would drop.** Directory entries, names that are not plain relative
  paths, duplicates after normalisation — read with `filenameValidation: 'tolerant'` for the same
  reason the player uses it. `plainRelativeName` is a copy of the player's `normalizeEntryName`,
  because the normalizer is plain JavaScript run by Node and cannot import the player's
  TypeScript; keep the two in step. `lib/fingerprint.mjs` is the same kind of copy, of the
  player's `indexFingerprint`: the summary prints the output's `revision` for a publisher's
  version record, and a shared test vector keeps the two recipes equal.
- **It checks what it decodes, and refuses what it cannot copy faithfully.** The `ZipReader` is
  opened with `checkSignature: true` — zip.js has no default, and `configure` does not reach it —
  so an entry whose bytes do not match their CRC stops the run, named, rather than being written
  out stored under the source's CRC as though intact; a stored mp4 it moves is checked by hand,
  since it is read in place and would otherwise get a fresh CRC over damaged bytes. An encrypted
  entry is refused: copied raw, AES lost its extra field and classic encryption its check byte.
  An mp4 with `saio` (Common Encryption) is left unmoved, because those are absolute offsets too.

Measured on the fixtures: `boardgame.h5p` grows 38.1 → 38.8 MB with 158 media entries inflated to
stored (its mp4s were already faststart); the h5p.com export keeps its media as it was and only
has its two stored JSON files deflated, 17 → 5 kB. `unzip -t` is the independent check on an
output. What the script cannot do is make a host that ignores `Range` serve a video before the
video has arrived: an entry enters the forward index only once it is complete, so on such a host
a normalized package gains the early boot and the seekable video, and still waits for the bytes.
