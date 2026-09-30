# Video that cannot stream

Why some packages make a learner wait for the whole video, what `preload="auto"` does about it,
and the command that fixes the package itself.

Most media starts playing while the rest arrives. Two properties of a package stop that, and
some exports have both:

- the media is **deflated** in the zip rather than stored, so there is no byte a `Range` request
  can reach without the whole stream up to it — and packagers routinely deflate an mp4 for a
  0.9% saving;
- the mp4 is **not faststart**, so its `moov` index is the last few kilobytes of the file, and no
  frame decodes until the final byte lands.

Together they mean a 220 MB video must transfer completely before it shows anything. Nothing on
the player's side shortens that: the bytes are genuinely required. What it can do is start
earlier.

```html
<h5p-player src="course.h5p" preload="auto"></h5p-player>
```

After the content is up, the player pulls large deflated entries in archive order, one at a time,
so the wait happens while the learner is still on the first slide instead of when they press
play. It waits for the content to appear first — those same bytes would otherwise compete with
the archive reads that boot the runtime — and it never runs two at once, which would only halve
the rate of whichever video is needed first.

It is off by default: it spends a learner's bandwidth on media they may never reach, and that is
the host's call. Progress arrives as `progress` events with `phase: 'extract'`.

The real fix belongs to whoever builds the package, and it ships as a command of its own,
[`@missing-elements/h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/normalize):

```bash
npx @missing-elements/h5p-normalize course.h5p                     # writes course.normalized.h5p beside it
npx @missing-elements/h5p-normalize https://…/course.h5p --dry-run  # inspect only
```

It rewrites the container and leaves the content alone: media is stored rather than deflated, an
mp4 whose index sits at the end is remuxed so the index comes first, entries are ordered so the
libraries arrive before the media, and text an exporter left stored is deflated. The package
grows by about 1% and any H5P host still accepts it. For the 220 MB example above, the video
starts after about a megabyte instead of after the last byte, and seeking works at once.
