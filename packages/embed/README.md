# @missing-elements/h5p-embed

Writes the H5P embed page as a static site for a player domain of your own. Any site then embeds
a package with an iframe and one script line. No H5P server, no backend, no third-party service.

Needs Node 22 or later. Write `@latest`: without it, npm on an older Node quietly installs the
last version that supported it, which writes a player from before 1.0.

```bash
npx @missing-elements/h5p-embed@latest h5p-player     # the folder defaults to ./h5p-player
```

Deploy it to any static host, then embed:

```html
<iframe src="https://h5p-player.example.net/?src=https://cdn.example.org/course.h5p"
        allow="fullscreen; microphone; camera" style="width: 100%; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

The script sizes the iframe to the content; a page that already loads h5p.org's `h5p-resizer.js`
needs no second one. `microphone` and `camera` are for Audio Recorder, Speak the Words and AR
Scavenger: a frame from another site gets neither unless the page allows it.

**Use a separate registrable domain** — `h5p-player.example.net`, not `h5p.example.com` — and put
nothing else on it: no accounts, no cookies. A package is JavaScript and runs as that origin, and
a subdomain shares your site's cookies.

## Options

| Option | Effect |
|---|---|
| `--packages <origins>` | Play packages and fetch library bundles only from these origins (the site's own is always allowed). Each host on its own, with no wildcard: the page compares exact origins. Add `https://cdn.jsdelivr.net` for `libraries=pack` on a site built with `--no-libraries`. Default: any https host |
| `--ancestors <origins>` | Only these sites may frame the page (`frame-ancestors`, header only). Default: any site |
| `--default-libraries <sources>` | The `libraries` value for addresses that name none: `pack` or URLs. Checked against `--packages`. Default: none, so exports without libraries are refused unless the address asks |
| `--no-libraries` | Leave out the library pack, 13.8 MB in `libraries/`, one archive per library, of which a learner's browser fetches only those a package needs; `libraries=pack` then fetches them from jsDelivr, where allowed |
| `--force` | Write into a non-empty folder, replacing only this tool's files |
| `-h`, `--help` / `-v`, `--version` | |

Origins are `https://host.example`, comma or space separated, no path or trailing slash;
`http://localhost` is accepted for local trials. **List every host a package URL redirects
through:** the browser's policy applies to each hop, and a redirect off the list fails as a plain
network error.

```bash
npx @missing-elements/h5p-embed@latest h5p-player \
  --packages https://cdn.example.org \
  --ancestors "https://www.example.org https://lms.example.org"
```

## Hosting

Any static host, over https, at a domain's root or under a path. The page carries its own
policy in a `<meta>` tag, so it is protected wherever it is served. The headers — the same
policy with `frame-ancestors`, and the caching — are written beside it in the form each kind of
host reads; use the one yours does and ignore the rest:

| Host | File |
|---|---|
| A server of your own — Hetzner, IONOS, OVH, Scaleway, a university's machine | `Caddyfile` (run it as it is; Caddy fetches the certificate), `nginx.conf` (include it in the server block), `.htaccess` (Apache with `mod_headers`) |
| Netlify, Cloudflare Pages | `_headers` |
| Vercel | `vercel.json` |
| GitHub Pages, S3 and other object storage | none can set headers: the page's `<meta>` policy applies, `--ancestors` does not, and `h5p-sw.js` is cached by the host's default |

The headers themselves, for a host not listed:

| Path | Headers |
|---|---|
| every path | `Content-Security-Policy` (the policy the command prints, with `frame-ancestors` from `--ancestors`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| `/h5p-sw.js` | `Cache-Control: no-cache`, so an update reaches learners on their next visit |
| `/frame-assets/*`, `/libraries/*` | `Cache-Control: no-cache`: the runtime and the library pack keep their file names between versions, so a copy from before an update must not be used after it |
| `/resizer.js` | `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` |

To update, run the command again with `--force` and redeploy.

## The address

| Parameter | Effect |
|---|---|
| `src=<url>` | The package, required. Encode `&`, `#`, `+`, `%` and spaces |
| `libraries=pack`, `<url>` or `none` | Where libraries come from; several are tried in order. `pack` is this domain's copy, or jsDelivr's without one: a package gets the libraries it lacks from it, and those it carries at the pack's newer versions. `none` turns off `--default-libraries` |
| `refresh-libraries=off` | Play the libraries a package carries as exported; `pack` then only fills gaps |
| `frame`, `copyright`, `export`, `icon`, `reporting` | H5P's action bar and its buttons |
| `fullscreen=off` | No fullscreen button |
| `preload=auto` | Start fetching media at once |
| `activity-id=<IRI>` | The xAPI object id, instead of the package URL |
| `custom-css=<url>` | A stylesheet loaded into the content |
| `lang=<tag>` | The language of H5P's own buttons and dialogs, such as `de` or `pt-BR`, for a package that does not name its own. A package that names its language in `h5p.json` gets them in that language, matching its content. Default: English |
| `xapi=<origin>` | Relay statements to the embedding page |

A custom script and a learner's name cannot be set on the address. Opened unframed, the page plays
a package from another origin `untrusted` unless `--packages` names it: none of the package's own
code runs, its libraries come from this domain's pack or `--default-libraries` (never from the
address's `libraries=`), and a button offers to play it with its own scripts only when it needs
them.

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
  libraryBundle,  // { url, origin, fromCache, refreshed? }, or null; refreshed: [{ library, from, to }]
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
`site/index.html` and `site/embed.css`). Its options: `pack` (the `@missing-elements/h5p-libraries`
export, which `libraries=pack` then plays from) or `packBase` (the folder of a copy of its
`parts/`), `packages` (allowed origins, `null` for any), `defaultLibraries`, `runtime` (the
`@missing-elements/h5p-runtime` export, for a bundled element) and `askInOwnFrame` (default
`true`; `false` plays a package from another origin as it is when a same-origin page frames it).
`librariesPack`, the URL of a whole `libraries.h5p`, still works, as a bundle that only fills gaps.
Both entries ship with TypeScript declarations.

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'
import { pack } from '@missing-elements/h5p-libraries'
import '@missing-elements/h5p-embed/embed.css'
import { startEmbed } from '@missing-elements/h5p-embed/embed.js'

startEmbed({ runtime, pack, defaultLibraries: 'pack' })
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
