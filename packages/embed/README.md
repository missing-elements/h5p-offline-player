# @missing-elements/h5p-embed

Self-hosted H5P embeds. One command writes the H5P embed page as a static site; you deploy it to
a player domain of your own, and any site — a page builder, a hosted CMS, an LMS page, a portal
with signed-in users — embeds a package with an iframe and one script line. No H5P server, no
backend, and no third-party service between your learners and your content.

```bash
npx @missing-elements/h5p-embed h5p-player
```

```
Wrote h5p-player/ (11.1 MB): the embed page, the player, the H5P runtime, the library pack.
```

Deploy the folder to any static host, then embed:

```html
<iframe src="https://h5p-player.example.net/?src=https://cdn.example.org/course.h5p"
        allow="fullscreen" style="width: 100%; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

The script line sizes the iframe to the content. A page that already has h5p.org's
`h5p-resizer.js` needs no second one; it speaks the same protocol.

## Why a domain of its own

An H5P package is JavaScript, and the player runs it on the origin that serves the page. On a
domain that holds nothing else, a package cannot reach your site's page, cookies, storage or APIs.
Use a separate registrable domain — `h5p-player.example.net`, not `h5p.example.com` — because a
subdomain is the same site and receives cookies set for `.example.com`. Put no accounts, no
cookies and nothing else on it.

## Options

| Option | Effect |
|---|---|
| `--packages <origins>` | Play packages, and fetch library bundles, only from these origins (this domain's own is always allowed). The page refuses anything else by name, and the policy's `connect-src` blocks it in the browser. Add `https://api.h5p.org` to allow `libraries=hub` |
| `--ancestors <origins>` | Only these sites may frame the page: `frame-ancestors`, which only a header can carry |
| `--default-libraries <sources>` | The `libraries` value for addresses that name none, so a snippet without `&libraries=` still plays an export that carries no libraries (h5p.com and h5p.org exports usually do not): `pack`, `hub`, URLs, as the parameter. Checked against `--packages` when the site is written. Default: none, and such exports are refused unless the address asks |
| `--no-libraries` | Leave out the 9.5 MB library pack; `libraries=pack` then means the hub, where allowed |
| `--force` | Write into a folder that is not empty, replacing only this tool's files |

Origins are written `https://host.example`, comma or space separated, with no path or trailing
slash. `http://localhost` is accepted for trying it locally.

List every host a package URL passes through. The page checks the address it is given, but the
browser's policy also applies to each redirect, so a listed host that redirects to a CDN off the
list fails as an ordinary network error, with nothing naming the list as the cause.

A player domain for one organisation is best locked to its own hosts:

```bash
npx @missing-elements/h5p-embed h5p-player \
  --packages https://cdn.example.org \
  --ancestors "https://www.example.org https://lms.example.org"
```

## Hosting

| Host | Policy and caching |
|---|---|
| Netlify, Cloudflare Pages | `_headers`, written beside the page |
| Vercel | `vercel.json`, written beside the page; deploy the folder as a project |
| GitHub Pages, S3, nginx, anything else | The page carries the policy in a `<meta>` tag. `--ancestors` needs a header: configure `Content-Security-Policy: frame-ancestors …` on the server, or leave it out |

The site works at the domain's root or under a path (`https://example.github.io/player/`): every
URL in it is relative, and the player's Service Worker takes the scope `<folder>/h5p/`. Serve it
over https; a frame in a page on plain http has no Service Worker.

`h5p-sw.js` should be served with `Cache-Control: no-cache`, as the header files say, so an update
reaches learners on their next visit. To update, run the command again with `--force` and
redeploy.

## The address

| Parameter | Effect |
|---|---|
| `src=<url>` | The package, required. Encode `&`, `#`, `+`, `%` and spaces in it |
| `libraries=pack`, `hub`, `<url>` or `none` | Libraries for an export that has none (h5p.com and h5p.org exports usually do not); `none` turns off the site's `--default-libraries` for this address. `pack` is the copy on this domain, with the hub behind it where allowed, or the hub alone on a site written with `--no-libraries`; several sources may be given, tried in order |
| `frame`, `copyright`, `export`, `icon`, `reporting` | H5P's action bar under the content and its buttons |
| `fullscreen=off` | No fullscreen button |
| `preload=auto` | Start fetching media at once |
| `activity-id=<IRI>` | The object id every xAPI statement names, instead of the package URL |
| `custom-css=<url>` | A stylesheet of yours, loaded into the content |
| `xapi=<origin>` | Relay statements to the embedding page, see below |

Not available on the address: a custom script, and a learner's name. A script is a capability on
the player's origin that a link should not hand out, and a name has no place in a URL.

Opened on its own (not framed), the page asks before playing a package from another origin
unless `--packages` names it: there, every package shares the domain's storage.

## Results

Add `&xapi=<the embedding page's origin>` and the frame posts every statement to that origin
and no other:

```js
const frame = document.querySelector('iframe')
addEventListener('message', ({ source, origin, data }) => {
  if (source !== frame.contentWindow || origin !== 'https://h5p-player.example.net') return
  if (data?.context !== 'h5p-offline-player') return
  if (data.action === 'xapi') send(data.statement)      // every statement
  if (data.action === 'finished') send(data.statement)  // the final one, with result.score
})
```

The checks prove where a message came from, not what it says: a package can post any statement,
so treat relayed results as the learner's report, not as proof for a grade. Each statement
carries `context.revision`, a fingerprint of the package build.

## Messages to the embedding page

Besides the heights and the relayed statements, the frame posts two messages to its parent,
whatever `xapi=` says. Neither carries anything the embedding page did not hand over itself.

```js
// Once, when the content is up: what the player learnt about the package.
{ context: 'h5p-offline-player', action: 'report',
  source,         // { type: 'range-http' | 'chunked' | 'file', size }: streamed, or downloaded whole
  metadata,       // { title, license, licenseVersion, authors: [names], mainLibrary }, from h5p.json
  libraryBundle,  // { url, origin, fromCache } when libraries came from a bundle, else null
  elapsedMs }     // from setting the package to the content being up

// Instead, when the load fails, or the page refuses the address (code: 'refused', or 'no-src').
{ context: 'h5p-offline-player', action: 'error', code, message }
```

The strings in `metadata` are the package's own; show them as text.

## As a library

```js
import { buildSite } from '@missing-elements/h5p-embed'

await buildSite({ out: 'public/player', packages: ['https://cdn.example.org'] })
```

`@missing-elements/h5p-embed/embed.js` exports `startEmbed()`, the page's script, for a site
that builds the page into its own pipeline. It reads the page's `<h5p-player>`, `#loader` and
`#notice` (see `site/index.html`, and `site/embed.css` for their styles) and takes:

| Option | |
|---|---|
| `librariesPack` | The URL of a copy of `@missing-elements/h5p-libraries`, which `libraries=pack` names |
| `packages` | The origins packages may come from, besides the page's own; `null` for any |
| `defaultLibraries` | The `libraries` value for addresses that name none |
| `runtime` | The `runtime` export of `@missing-elements/h5p-runtime`, for a bundled element |
| `askInOwnFrame` | `false` to skip the click a package from elsewhere otherwise waits for when a page of the same origin frames this one — for a site whose own preview frames it for a package the visitor just chose. Default `true` |

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'
import librariesPack from '@missing-elements/h5p-libraries/libraries.h5p?url'
import '@missing-elements/h5p-embed/embed.css'
import { startEmbed } from '@missing-elements/h5p-embed/embed.js'

startEmbed({ runtime, librariesPack, defaultLibraries: 'pack' })
```

## Licences

This package is MIT. The folder it writes also carries
[`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime), the
H5P core runtime, under the GPL-3.0, as `frame-assets/` with its `LICENSE.txt` and `NOTICE.txt`;
and, unless `--no-libraries`, the H5P hub's libraries under their own licences, listed in
`libraries.txt`. `NOTICE.txt` in the folder says which file is what.
