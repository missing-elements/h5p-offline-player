# Privacy and data protection

What the player stores, what it sends and to whom, for the privacy notice of a site that runs it
and for a GDPR, security or vendor review. It describes the player; your site, your package host
and the content you play have their own answers. This is not legal advice.

## In short

- No account, no cookies, no telemetry. The player itself contacts no service of ours or of
  H5P Group's, unless you set `libraries` to `hub`.
- Nothing it stores leaves the learner's browser. It stores no xAPI statements and no results.
- Results reach your page as `xapi` events. Where they go from there is your decision.
- Self-hosted, the only processor in the learner's path is your own hosting. That stays true if
  you use [`@missing-elements/h5p-embed`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/embed#readme)
  on a player domain you run. It is not true for a public service such as Embed My.

## What is stored, on the learner's device

All of it lives in the browser's storage for the origin that serves the player. On the Embed
setup, that is your player domain, kept separately for each site that frames it.

| What | Where | Contains | Personal? |
|---|---|---|---|
| Extracted package files | Cache API, `h5p-pkg-v0-*` | The package's own files | No, unless the package contains personal data |
| Package list | IndexedDB `h5p-player`, table `packages` | Each package's URL or picked file name, title, metadata, display options, last played time | Shows which content was played on this device |
| Saved state | IndexedDB `h5p-player-userdata` | Only with `resume` (or `resume="device"`): the content's own state, such as the slide reached, the answers given and the position in a video, with the time it was saved | Yes: a learner's answers |

The learner's name and email, if you set the `user` property, are not stored. They go into each
statement and nowhere else.

Any package played on the same origin can read all three. With `resume` on, or with packages you
did not make, that is a reason to use the Embed setup on a domain of its own; see *Which setup* in
the [README](https://github.com/missing-elements/h5p-offline-player#which-setup).

## What is sent, and to whom

| Request | Goes to | When |
|---|---|---|
| The package | The host in `src` | Every load from a URL. A picked file is not sent anywhere |
| The player and runtime files | Your site, or a CDN if `assets-base` names one (jsDelivr in the README's example) | Every load |
| Library bundle | The URL in `libraries` | A package without its own libraries. Serve `libraries.h5p` from your own domain to keep this on your hosting |
| H5P hub | `api.h5p.org` (H5P Group) | Only with `libraries` naming `hub`, and only when no earlier source covered the package |
| MathJax | `cdn.jsdelivr.net` or `cdnjs.cloudflare.com` | Only content that shows formulas (`H5P.MathDisplay`) |
| Web fonts | `ajax.googleapis.com`, `fonts.googleapis.com`, `fonts.gstatic.com` (Google) | Only content types that load Google Fonts |
| Video players | YouTube, Vimeo, Panopto | Only content that embeds them. These set their own cookies |
| Speech recognition | The browser's own service (Google, in Chrome) | Only content types that use speech input |

Every one of these requests carries the learner's IP address to its host. The last four rows
depend on the content, not on the player: the frame's CSP allows those hosts so that the content
types work, and blocks any other script, style or font source. Images, media and embedded frames
may come from anywhere the content names. List what your packages actually use in your privacy
notice. A German court has held that loading Google Fonts from Google's servers without consent
breaches the GDPR (LG München I, 3 O 17493/20, 2022).

## xAPI statements

The element emits each statement as an `xapi` event and keeps nothing.

- Without the `user` property, the actor is H5P's anonymous one. With it, the statement carries
  the name and email you set.
- `context.revision` identifies the package build, and `context.platform` the player version.
  Neither identifies the learner.
- On the Embed setup, statements reach your page only when the address names your page's origin in
  `xapi=`, and are posted to that origin alone. The page also tells whatever page frames it when
  the package is ready, with the package's source, metadata, library bundle and load time, and
  when it fails; neither message carries anything about the learner.
- With [`@missing-elements/h5p-cmi5`](cmi5.md), statements go to the LMS's LRS, under the launch's
  learner and registration. The launch token stays in memory unless you choose `storage`.

## Answering a data subject request

There is no server-side table to search. What the player holds is on the learner's device:

- **Access or export:** the saved state can be read from the browser's IndexedDB on that device.
  Under `resume="host"`, it is in your own system, as you stored it from `userdata` events.
- **Erasure:** `clearUserData()` removes the saved state for the package loaded now. Clearing
  the site's data in the browser removes all three stores. On the Embed setup, that is the player
  domain's data.
- **Rectification:** the saved state is the content's own; starting the content over replaces it.

Results, xAPI statements and anything stored under `resume="host"` are wherever your page sent
them: your backend, an LRS, an LMS. Those systems answer the request for that data.

## H5P's own GDPR guide, side by side

H5P Group's [guide for its plugins](https://h5p.org/plugin-gdpr-compliance) assumes a server.

| H5P plugin | This player |
|---|---|
| Results in a server table (`h5p_results`, `hvp_xapi_results`) | Not stored. `xapi` events to your page |
| Saved state in a server table (`h5p_contents_user_data`) | Off by default. On the device with `resume`, or in your system with `resume="host"` |
| xAPI with the user's name and an identifier | Only if you set `user` |
| Anonymous usage statistics sent to h5p.org | None |
| YouTube, Twitter and speech recognition | The same; they come with the content |
| Hub, CDNs and fonts (not covered there) | In the table above |
