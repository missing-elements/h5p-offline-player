---
name: h5p-normalize
description: Make an H5P package (.h5p) stream, so its video starts at once instead of after the whole file has downloaded. Use when H5P video or audio is slow to start, plays only after minutes, cannot be seeked, or fails on a static host or GitHub Pages; and before publishing a package with media to a static site. Rewrites the zip container once; the content is not changed.
license: MIT
---

# Normalize an H5P package

When a package's video takes minutes to start, the package is usually the problem, not the
player or the host. Two things inside the zip cause it: the video is *deflated* (compressed
inside the archive, so no byte of it can be read without everything before it), and the mp4's
index (`moov`) sits at the end of the file, so nothing decodes until the last byte. Both are
fixed by rewriting the container once, with the content left as it is. Do this where the
package is published, never in the learner's browser.

## 1. Diagnose with a dry run

    npx @missing-elements/h5p-normalize course.h5p --dry-run

Read the summary at the end. The `media` line is the verdict:

    media     22 files: 22 already as they should be        → nothing to do; the problem is elsewhere
    media     6 files: 4 inflated to stored, 1 mp4 index moved to front, 1 already as they should be
                                                            → normalize it

A `notes` line names what it leaves as it is: a fragmented mp4, an encrypted entry, a video it
could not remux. A damaged entry (its bytes not matching their CRC) stops the run with the
entry named. Report both to the user rather than working around them. A URL works in place of
the path.

If the dry run finds nothing to do and the video is still slow, the package is not the cause:
the host may ignore `Range` requests, so the whole archive downloads before anything plays
(`curl -sI -H 'Range: bytes=0-0' <url>` answers `200` rather than `206`), or the link is slow
for a file that size. Then it is a hosting question, not a package one.

## 2. Rewrite it

    npx @missing-elements/h5p-normalize course.h5p                     # writes course.normalized.h5p beside it
    npx @missing-elements/h5p-normalize course.h5p -o dist/course.h5p  # or where you say

It refuses to write over its input, so replacing the original is a rename afterwards.

What changes: media (video, audio, images, fonts, PDF) is stored instead of deflated; an mp4
with its index at the end is remuxed so the index comes first, which moves bytes and changes
no picture; entries are ordered `h5p.json`, library folders, content, media last, so a host that
ignores `Range` requests still boots the player before the media has arrived; stored text
files are deflated. The package grows by about 1% and every H5P host still accepts it.

## 3. Check it

- `unzip -t course.normalized.h5p` is an independent check that the archive is whole.
- `npx @missing-elements/h5p-verify course.normalized.h5p` plays it; do this before handing it
  over, since a package that has been rewritten is a package that could have been broken.
- A second dry run on the output reports every media file as "already as they should be".

## 4. Hand over

Give the user the `revision` line from the summary with the file. It is the build identifier
h5p-offline-player puts in `context.revision` on every xAPI statement from this package, so a
completion record can later be matched to this exact build; it belongs in their release notes
or version record. Tell them to publish the normalized file, keep the original, and that a
host which honours `Range` requests (most static hosts, GitHub Pages included) is what makes
the seeking instant; on one that does not, the boot is early but the video still waits for its
bytes.

## What it does not do

It does not re-encode, resize or transcode video; a 220 MB video is still 220 MB and still has
to cross the network. It does not add libraries a stripped export lacks (that is the player's
`libraries` attribute). It does not change `content.json`.

Why deflated video cannot stream, with a diagram:
https://h5p-offline-player.vercel.app/demo/normalize.html
