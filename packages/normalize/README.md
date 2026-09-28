# @missing-elements/h5p-normalize

Rewrites an `.h5p` package once so that it streams well through
[h5p-offline-player](https://github.com/missing-elements/h5p-offline-player). The content is not
changed; only the zip container is:

- media (video, audio, images, fonts, PDF) is stored rather than deflated, so a `Range` request
  can reach any byte of it directly;
- an mp4 whose index (`moov`) sits at the end is remuxed so the index comes first — a remux, not
  a re-encode;
- entries are ordered `h5p.json`, library folders, content, with content media last;
- scripts, styles and JSON an exporter left stored are deflated.

```bash
h5p-normalize course.h5p               # writes course.normalized.h5p
h5p-normalize course.h5p --dry-run     # report only
h5p-normalize https://host.example/course.h5p -o course.h5p
```

From a checkout of the repository: `pnpm normalize -- course.h5p`.

Why this matters is explained on the demo site's normalize page
([`apps/demo/demo/normalize.html`](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/demo/normalize.html))
and in the repository's `AGENTS.md`, under *The normalizer*.
