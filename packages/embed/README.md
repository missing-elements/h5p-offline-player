# @missing-elements/h5p-embed

Writes the H5P embed page as a static site for a player domain of your own. Any site then embeds
a package with an iframe and one script line. No H5P server, no backend, no third-party service.
With `--scorm`, it writes one package as a SCORM zip instead, for an LMS such as Moodle, ILIAS,
OpenOLAT or Chamilo to play and grade, and the site it writes carries a page that builds the same
zip in the browser, for anyone with a `.h5p` and no terminal (see
[A SCORM package, for an LMS](#a-scorm-package-for-an-lms)).

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
| `--scorm <package.h5p> [zip]` | Write a SCORM package of one `.h5p` instead of the site, 1.2 unless `--scorm-version` says 2004; see [A SCORM package, for an LMS](#a-scorm-package-for-an-lms) |
| `--title <text>` | With `--scorm`, the title the LMS lists the package by. Default: the title in its `h5p.json` |
| `--scorm-version 2004` | With `--scorm`, SCORM 2004 4th Edition rather than 1.2; see [Options](#options-of-the-zip) |
| `--pass-mark <0-100>` | With `--scorm`, the score that passes, in place of the content's own pass or fail |
| `--completion-score` | With `--scorm`, record content that finishes without a score as 100 |
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
| `src=<url>` | The package, required: an `http` or `https` URL, or a path on the player domain. Encode `&`, `#`, `+`, `%` and spaces |
| `libraries=pack`, `<url>` or `none` | Where libraries come from; several are tried in order. `pack` is this domain's copy, or jsDelivr's without one: a package gets the libraries it lacks from it, and those it carries at the pack's newer versions. `none` turns off `--default-libraries` |
| `refresh-libraries=off` | Play the libraries a package carries as exported; `pack` then only fills gaps |
| `downgrade-libraries=off` | Refuse content made for a newer version of a library than any source has, instead of playing it at the newest older one |
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

## A SCORM package, for an LMS

```bash
npx @missing-elements/h5p-embed@latest --scorm course.h5p     # writes ./course.scorm.zip
```

writes one package as a SCORM 1.2 zip, or 2004 with an [option](#options-of-the-zip): the
package, the player and the H5P runtime, and a launch page that reports to the LMS. Add it to a course as a SCORM activity, in one of the
[supported LMSs](#supported-lmss) or another that takes SCORM 1.2, and the LMS records:

- the score out of 100, and `passed` or `failed` when the content says whether it was passed,
  `completed` when it does not. The content's last result counts, as on an H5P site;
- each question's answer, as `cmi.interactions`: the question's words as the id, its type, the
  answer given and the right one, `correct` or `wrong`, the marks it was worth and the time it
  took. One interaction per question, written over when it is answered again, which is how
  Moodle's interactions report lines learners up. SCORM 1.2 lets the content write these and
  never read them; the LMS's reports do;
- the time spent in each session;
- the learner's place: the content's saved state goes into `cmi.suspend_data`, compressed, and
  the next launch continues from it, for a content type that saves one, as Question Set, Course
  Presentation, Interactive Book, Interactive Video and most single questions do. An Accordion,
  Image Hotspots, Flashcards or a Timeline starts over, as on any H5P site. SCORM 1.2 keeps 4,096 characters; compressed, a quiz's state
  takes about 200, a twelve-chapter Interactive Book about 1,000, and none of 23 real packages
  measured passed 1,100. One that does not fit is not saved, the last that fitted stays, and
  the page says so under the content, once. Moodle keeps 64,000 when its administrator turns
  "SCORM 1.2 standard mode" off.

An export from h5p.com or h5p.org, which leaves the libraries out, works as well: the zip carries
the ones it needs from the library pack, and only those. For a quiz with formulas, that is 11
libraries, 4 MB, most of it the formula renderer. A package that carries its libraries, as exports
from Lumi and the H5P plugins of Moodle, WordPress and Drupal do, plays with its own. One that needs
a library neither it nor the pack has, or a newer version than the pack's, is refused, with what is
missing named.

The package plays trusted: its own code runs on the LMS's origin, as every SCORM package's does.
The LMS has to be served over https, since the player needs its Service Worker.

Content that reports no result of its own, an Accordion, a Virtual Tour, or a presentation or a
book without questions, stays `incomplete`: complete such an activity on viewing it instead.
Replacing the zip with one written from another `.h5p`, or with other libraries from the pack,
starts learners over, since their saved state belongs to what it was saved in.

An [agent skill](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-to-scorm)
takes an agent through it, from checking the package to the setting each LMS needs:
`npx skills add missing-elements/h5p-offline-player --skill h5p-to-scorm`.

### Options of the zip

Three, each off unless asked for; a zip written with none is the SCORM 1.2 zip described above.

- **SCORM 2004 4th Edition** (`--scorm-version 2004`), checked in Moodle 4.5 and SCORM Cloud. The
  LMS keeps completion and the pass apart, so a failed attempt still counts as completed; the
  score is scaled as well as out of 100; each answer carries the question's words as its
  description; and the saved state may run to 64,000 characters. A learner who comes back to a
  finished activity finds it as they left it, with its result kept.
- **A pass mark** (`--pass-mark 80`): a score at or above it passes, whatever the content says,
  and below it fails. The LMS gets it as the mastery score (1.2) or the passing score (2004), and
  a mark the LMS holds of its own wins. Content that reports no score gets no pass or fail from
  it.
- **Completion as 100** (`--completion-score`): content that finishes without a score, such as a
  questionnaire or a branching scenario without scoring, is recorded as 100, for a gradebook that
  needs a number; with a pass mark, that passes. Content that never finishes still stays
  `incomplete`, a presentation or a book without questions among it.

### In the browser

The site `h5p-embed` writes carries the same converter as a page, `scorm.html`, in four steps.
Choose `.h5p` files, or drop them on it; review each one, which shows the main library and its
version, the size, whether it carries its libraries or how many it takes from the pack, or why it
cannot be built, and the title the LMS will list it by, which you can change; choose the
[options](#options-of-the-zip) for all of them, or leave them; then build, and download each
zip, or all of them in one. They are built in the browser from the site's own
copies of the player, the runtime and the library pack, the same zips as the command's. Nothing
is uploaded and no `npx` is needed; the page says which LMSs the zip is checked in and what each
needs. The demo site has it at
[/demo/scorm.html](https://h5p-offline-player.vercel.app/demo/scorm.html).

### Supported LMSs

Checked at these versions, as a learner in Chrome. Other LMSs have not been tried yet.

| LMS | Add the zip as | Change from the defaults | The package is read | SCORM 2004 and the grading options |
|---|---|---|---|---|
| Moodle 4.5 | a SCORM package activity | nothing; keep the maximum grade at 100 | in ranges | checked |
| ILIAS 11 | a SCORM learning module | turn Learning Progress on | whole | not yet |
| OpenOLAT 21.1 | a "SCORM 1.2" course element | the pass mark; in a learning path, the completion criterion | in ranges | not yet |
| Chamilo 3.0 | an imported learning path | publish the learning path | whole | not yet |
| SCORM Cloud | a course | nothing | in ranges | checked |
| Frappe LMS, `develop` | a SCORM chapter | nothing; the content needs a pass mark | whole | not yet |

Whether a pass mark written into the zip takes the place of the pass mark OpenOLAT and Frappe LMS
ask for has not been checked yet.

All of them record the score, whether it passed, the time and the learner's place, except Frappe
LMS, which records only a pass and the learner's place. Where the package is read whole, it is
downloaded in full when it opens, and a large video in it starts once the download has reached it;
a quiz does not notice.

**Moodle.** The score goes to the gradebook as the grade, out of the activity's maximum grade, so
keep that at 100, its default. Moodle has to serve files by path, which it does by default
(`slasharguments`).

**ILIAS.** Learning Progress is off in a fresh ILIAS, and without it ILIAS's SCORM player keeps
the learner's place and drops every score and status the content sends. Turn it on in
Administration, then in the module's Learning Progress settings choose "Collection of SCORM Items"
and tick the item. ILIAS sent the larger packages whole; only one of a few kilobytes came in ranges.

**OpenOLAT.** Its grading takes the score with a pass mark of 0, so every result counts as passed, a
failed quiz too: set "Score needed to pass" to the quiz's own pass mark, or choose "Transfer passed
value", which takes pass or fail from the content and no score. In a learning-path course the
element counts as done only once the learner confirms it: choose "Passed" as its completion
criterion.

**Chamilo.** Chamilo imports a learning path unpublished, so publish it before learners can see it.
Chamilo 1.11 has not been tried.

**Frappe LMS.** Frappe marks the lesson done only when the content reports a pass, so a quiz needs a
pass mark; a failed attempt, or content that reports only `completed`, leaves the lesson open. It
keeps no score.

A zip written by embed 1.3.0 or earlier is worth writing again with the current version. SCORM
Cloud cannot import it ("IO Error processing zip"), nor, likely, can some other LMSs written in
Java, though OpenOLAT can; ILIAS keeps no time for a session played from it that the learner ends
by closing the tab, and Chamilo does not record that such a session was left unfinished, though it
resumes it.

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
`buildScorm` from `@missing-elements/h5p-embed/scorm` is `--scorm`: it takes `h5p`, `out`,
`force`, `title`, and the options, `scormVersion` (`'1.2'`, the default, or `'2004'`),
`passMark` (0 to 100, or `null`) and `completionScore` (`false` by default), and returns the zip's
path, its title, the options as written into it (`scormVersion`, `passMark` kept to the
hundredth, `completionScore`), size, the `libraries` it carries from the pack, and `build`, the
stamp saved state is kept against. Every entry ships with TypeScript declarations.

`buildScormInPage` from `@missing-elements/h5p-embed/scorm/browser` is the same build in a page:
it takes `file`, a `File` or `Blob`; `base`, the folder with the player's three files and
`frame-assets/` (the page's own by default); `pack` or `packBase`, as `startEmbed` takes them;
`assets`, for a page that bundles the launch page's template, its bridge, its compressor
(`lz`, `scorm/lz-string.js`), `embed.css` and the pack's `libraries.txt` rather than serving them
beside the player as the written site does, where a page that gives the template and not the
compressor gets the one at `base`, or a zip without it that keeps the saved state plain, as 1.4
did;
`version` and `packVersion`, for the zip's notice; `title` and the options, as `buildScorm`
takes them; and `onProgress`. It returns the zip as a `Blob`, with its `name`, `title`, the
options as `buildScorm` returns them, `libraries`, `build` and `size`. `planScormInPage`, from
the same module, takes the same options and stops before anything is written: it reads the
package and returns what its zip will hold, its `title` (the one given, else the package's),
`mainLibrary`, `size`, the `libraries` from the pack and their `librariesSize`, or refuses it as
the build would, and `write({ title, scormVersion, passMark, completionScore })` then writes the
zip, as often as asked, each of the four defaulting to the plan's. `startScormPage`
from `@missing-elements/h5p-embed/scorm-page.js` is the page's script, which reads the page's
`#file`, `#status`, `#download` and `#notice`, and works in steps where the page also holds
`#files`, the list it puts a row in for each file, and `#build`, the button that builds them, and
takes the options from radios named `scorm-version`, `#pass-mark` and `#completion-score` where
the page has them (see `site/scorm.html`); a page without `#files` and `#build` builds the first
file at once, as before. The written
site loads it bundled, with zip.js inside, and a page that bundles imports the source.

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
`cdn.jsdelivr.net`. A SCORM package contacts nothing but the LMS it was uploaded to, which gets the
score, the result, the time spent and the learner's saved state. What the player stores and
sends, for a privacy notice or a GDPR review:
[Privacy and data protection](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md).

## Licences

MIT. The written folder also carries
[`@missing-elements/h5p-runtime`](https://www.npmjs.com/package/@missing-elements/h5p-runtime)
under the GPL-3.0, as `frame-assets/` with its `LICENSE.txt` and `NOTICE.txt`, and, unless
`--no-libraries`, the hub's libraries under their own licences, listed in `libraries.txt`. The
folder's `NOTICE.txt` says which file is what. A SCORM zip carries the runtime the same way, the
package under its own licences, and any libraries from the pack as the folder does; its
`NOTICE.txt` says the same. The folder's `scorm-page.js` carries zip.js, BSD-3-Clause, with its
licence in its header, as the player's workers do.
