# @missing-elements/h5p-embed

Writes the H5P embed page as a static site for a player domain of your own. Any site then embeds
a package with an iframe and one script line. No H5P server, no backend, no third-party service.

```bash
npx @missing-elements/h5p-embed h5p-player     # the folder defaults to ./h5p-player
```

Deploy it to any static host, then embed:

```html
<iframe src="https://h5p-player.example.net/?src=https://cdn.example.org/course.h5p"
        allow="fullscreen" style="width: 100%; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

The script sizes the iframe to the content; a page that already loads h5p.org's `h5p-resizer.js`
needs no second one.

**Use a separate registrable domain** — `h5p-player.example.net`, not `h5p.example.com` — and put
nothing else on it: no accounts, no cookies. A package is JavaScript and runs as that origin, and
a subdomain shares your site's cookies.

## Options

| Option | Effect |
|---|---|
| `--packages <origins>` | Play packages and fetch library bundles only from these origins (the site's own is always allowed). Add `https://cdn.jsdelivr.net` for `libraries=pack` on a site built with `--no-libraries`. Default: any https host |
| `--ancestors <origins>` | Only these sites may frame the page (`frame-ancestors`, header only). Default: any site |
| `--default-libraries <sources>` | The `libraries` value for addresses that name none: `pack` or URLs. Checked against `--packages`. Default: none, so exports without libraries are refused unless the address asks |
| `--no-libraries` | Leave out the 9.8 MB library pack; `libraries=pack` then fetches it from jsDelivr, where allowed |
| `--force` | Write into a non-empty folder, replacing only this tool's files |
| `-h`, `--help` / `-v`, `--version` | |

Origins are `https://host.example`, comma or space separated, no path or trailing slash;
`http://localhost` is accepted for local trials. **List every host a package URL redirects
through:** the browser's policy applies to each hop, and a redirect off the list fails as a plain
network error.

```bash
npx @missing-elements/h5p-embed h5p-player \
  --packages https://cdn.example.org \
  --ancestors "https://www.example.org https://lms.example.org"
```

## Hosting

| Host | Policy and caching |
|---|---|
| Netlify, Cloudflare Pages | `_headers`, written beside the page |
| Vercel | `vercel.json`, written beside the page |
| GitHub Pages, S3, nginx, others | a `<meta>` policy in the page; `--ancestors` needs a `Content-Security-Policy: frame-ancestors …` header set on the server |

It works at a domain's root or under a path, over https. Serve `h5p-sw.js` with
`Cache-Control: no-cache`. To update, run the command again with `--force` and redeploy.

## The address

| Parameter | Effect |
|---|---|
| `src=<url>` | The package, required. Encode `&`, `#`, `+`, `%` and spaces |
| `libraries=pack`, `<url>` or `none` | Libraries for an export without them; several are tried in order. `pack` is this domain's copy, or jsDelivr's without one; `hub` means `pack`; `none` turns off `--default-libraries` |
| `frame`, `copyright`, `export`, `icon`, `reporting` | H5P's action bar and its buttons |
| `fullscreen=off` | No fullscreen button |
| `preload=auto` | Start fetching media at once |
| `activity-id=<IRI>` | The xAPI object id, instead of the package URL |
| `custom-css=<url>` | A stylesheet loaded into the content |
| `xapi=<origin>` | Relay statements to the embedding page |

A custom script and a learner's name cannot be set on the address. Opened unframed, the page asks
before playing a package from another origin unless `--packages` names it.

## Messages

With `&xapi=<embedding page's origin>` the frame posts statements to that origin only:

```js
const frame = document.querySelector('iframe')
addEventListener('message', ({ source, origin, data }) => {
  if (source !== frame.contentWindow || origin !== 'https://h5p-player.example.net') return
  if (data?.context !== 'h5p-offline-player') return
  if (data.action === 'xapi') send(data.statement)      // every statement
  if (data.action === 'finished') send(data.statement)  // the final one, with result.score
})
```

A package can post any statement, so treat relayed results as the learner's report, not proof
for a grade. Each carries `context.revision`, the package build's fingerprint.

Whatever `xapi=` says, the frame also posts to its parent:

```js
{ context: 'h5p-offline-player', action: 'report',
  source,         // { type: 'range-http' | 'chunked' | 'file', size }
  metadata,       // { title, license, licenseVersion, authors, mainLibrary }, from h5p.json; show as text
  libraryBundle,  // { url, origin, fromCache }, or null
  elapsedMs }
{ context: 'h5p-offline-player', action: 'error', code, message }  // code 'refused', 'no-src' or the load's
```

## As a library

```js
import { buildSite } from '@missing-elements/h5p-embed'
await buildSite({ out: 'public/player', packages: ['https://cdn.example.org'] })
```

`buildSite` takes `out`, `libraries` (default `true`), `packages`, `ancestors`, `defaultLibraries`
and `force`, as the flags. `@missing-elements/h5p-embed/embed.js` exports `startEmbed()`, the
page's script, which reads the page's `<h5p-player>`, `#loader` and `#notice` (see
`site/index.html` and `site/embed.css`). Its options: `librariesPack` (the URL `libraries=pack`
names), `packages` (allowed origins, `null` for any), `defaultLibraries`, `runtime` (the
`@missing-elements/h5p-runtime` export, for a bundled element) and `askInOwnFrame` (default
`true`; `false` skips the click when a same-origin page frames it).

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'
import librariesPack from '@missing-elements/h5p-libraries/libraries.h5p?url'
import '@missing-elements/h5p-embed/embed.css'
import { startEmbed } from '@missing-elements/h5p-embed/embed.js'

startEmbed({ runtime, librariesPack, defaultLibraries: 'pack' })
```

## Privacy

The site sets no cookies and sends nothing anywhere of its own. Learners' browsers contact your
player domain, the package hosts and, only for `pack` on a site built with `--no-libraries`,
`cdn.jsdelivr.net`. What the player stores and
sends, for a privacy notice or a GDPR review:
[Privacy and data protection](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md).

## Licences

MIT. The written folder also carries
[`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime)
under the GPL-3.0, as `frame-assets/` with its `LICENSE.txt` and `NOTICE.txt`, and, unless
`--no-libraries`, the hub's libraries under their own licences, listed in `libraries.txt`. The
folder's `NOTICE.txt` says which file is what.
