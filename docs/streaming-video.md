# Video that cannot stream

A video cannot start until it has arrived whole when the package has both of these:

- the media is **deflated** in the zip rather than stored, so no `Range` request can reach a byte
  without the whole stream before it;
- the mp4 is **not faststart**, so its `moov` index is at the end and nothing decodes until the
  last byte.

The player cannot shorten that wait, only start it earlier:

```html
<h5p-player src="course.h5p" preload="auto"></h5p-player>
```

Once the content is up, the player extracts large deflated entries in archive order, one at a
time. It is off by default because it spends bandwidth on media the learner may never reach.
Progress arrives as `progress` events with `phase: 'extract'`.

The fix is to the package, with
[`@missing-elements/h5p-normalize`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/normalize):

```bash
npx @missing-elements/h5p-normalize course.h5p                     # writes course.normalized.h5p beside it
npx @missing-elements/h5p-normalize https://…/course.h5p --dry-run  # inspect only
```

It rewrites the container and leaves the content alone: media stored, mp4 index moved to the
front, libraries ordered before media, stored text deflated. The package grows by about 1% and
any H5P host still accepts it; the video then starts after its first megabyte and seeks at once.
