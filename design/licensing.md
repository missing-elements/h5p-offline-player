# Licensing and names

## Licensing

The player, `@missing-elements/h5p-offline-player`, is MIT, and nothing in it is anything else. The
H5P core runtime it loads is not: h5p.js, the event dispatcher, xAPI, the content type base, the
confirmation dialog, the request queue, the action bar, the tooltip, the stylesheets and the
`h5p-*` icon fonts are `h5p/h5p-php-library`'s, which is GPL-3.0 by its LICENSE.txt and
composer.json. The runtime vendors them from upstream at a commit (`vendor/h5p-core/SOURCE.json`).
H5P's own licensing page says the GPL is there because of the HTML purifier on the PHP side and has
promised since 2017 to make it optional; the JavaScript carries no separate grant, so it is GPL by
the repository's terms.

The runtime, its stylesheet and fonts, and `frame-boot.ts`, the one piece of our code that runs
inside the H5P document and calls the core's API, are `@missing-elements/h5p-runtime`,
GPL-3.0-only, with the GPL text as its LICENSE. The player's element and workers exchange HTTP and
`postMessage` with that package and nothing else: no import, no shared memory, no function call.
That is the arrangement the GPL FAQ describes as separate programs communicating at arm's length.
It does not settle the question, nothing short of a lawyer's opinion does, and the README says so,
but it makes the answer defensible, and a scanner on the MIT package finds no GPL. The boot script
is GPL by choice, not necessity: licensing our own file MIT inside the GPL package would be
allowed, and would reopen the "intimate call" argument the split exists to close. Moving our own
code to the GPL was decided against: Setup A bundles the element into a host's own bundle, where a
GPL dependency is what corporate policies and scanners refuse. MPL-2.0 remains the middle ground if
closed forks ever matter. Three things follow:

- `packages/runtime/NOTICE.md` is kept by hand; `dist/LICENSE.txt` and `dist/NOTICE.txt` are
  written by the runtime's build, so they always name the h5p-php-library commit actually
  vendored, which with the build is the corresponding source. Moving the core (`pnpm core:sync`)
  regenerates them and means re-reading that NOTICE.md, which names the commit as of its writing.
  The player's `NOTICE.md` says where the runtime went and carries zip.js's notice.
- What a user ships has to carry its notices *in the file*, because a bundler emits each file on
  its own and nothing from the package root goes with it. So every shipped file with third-party
  code opens with a `/*! … */` header: the two workers carry zip.js's BSD-3-Clause licence in full
  (`zipJsNotice` in `scripts/lib/worker-bundle.mjs`, read from the installed package; its clause 2
  asks for the whole text), and the runtime's `frame.bundle.js`, `h5p.css` and `frame-boot.js`
  name their licences and the corresponding source; `frame.bundle.js` keeps jQuery's own `/*!`
  notice inside it too. A new dependency that ends up in a bundle means a new header and a new
  entry in the right NOTICE.md.
- Our own shipped files carry a one-line notice too (`playerNotice` in
  `scripts/lib/worker-bundle.mjs`, on the element, both Service Worker scripts and the Jobs
  worker; the runtime's `index.js` and `frame-boot.js` carry their own, GPL): MIT asks for its
  notice to accompany copies.

The demo site serves the runtime's `dist/` as `/frame-assets/`, so the same files and notices are
on it; `index.html`'s JSON-LD names MIT and its footer names the runtime's licence.
`@missing-elements/h5p-libraries` is a third case: other people's libraries under their own
licences (MIT mostly, two MPL, two GPL-3.0), so its `license` field says `SEE LICENSE IN
libraries.txt` and that file lists every one.

The VS Code extension is MIT and carries the runtime and the libraries as separate files beside its
bundle, as the embed package's site does; its `NOTICE.txt`, written by its build, says which file is
what, with the versions carried.

**The setups are named, both are self-hosting, and Install comes first.** The player's main benefit
is that a host runs H5P on its own infrastructure, with no H5P server, no backend and no
third-party service in the learner's path, and the README, the demo's setup page ("Host it
yourself"), the front page, the social card and the `h5p-player-setup` skill lead with that. The
documents present **Install** (with a bundler, or without a build step) first and **Embed**, the
`/embed` page on a separate player domain the host runs, second. The *Which setup* table still
chooses by what is on the site's origin, and its safety rows still win: signed-in users, or
packages the site did not make, mean Embed, for the reason *What a public demo means* gives (a
package is JavaScript, and installed, it runs as the host site), or Install with those packages
`untrusted` (every package, on a site with sessions), which runs none of their code and checks
their content as the CMS plugins do. The letters are gone from the user docs, which say "formerly
Setup A/B/C" under each heading; this file still says Setup A (bundler), B (no build step) and C
(Embed).

## Names and the H5P trademark

H5P is H5P Group's trademark. Its policy (h5p.org/trademark) lets open-source software lead its
name with "H5P" only when the name says who made it, rule 5 of its automatic approval: "Acmes H5P
interactive Quiz" is approved, "H5P interactive Quiz" is not ("No author, suggests endorsement").
Applied to this repository:

- the installable app is "H5P Offline Player by Missing Elements" in its manifest, page, About
  dialog and window title, and "Offline Player" as its short name, which has no room for an
  author;
- the site's name carries "by Missing Elements" beside `h5p-offline-player` in the bar, under it
  there (`.brand-by`, so the bar is no wider; one line in an installed window's title bar), in
  every page's `og:site_name`, in the front page's `WebSite` name and on the social card;
- the header of the pack's `libraries.txt`, which the pages link, says it too, in step with its
  generator so that the weekly refresh sees no change.

Left as they are: the npm names, whose scope names the author, and which the policy treats as
names in code, and so the repository's name, `missing-elements/h5p-toolkit`; descriptive uses
("Self-hosted H5P …"), which it allows as a "secondary identifier"; the `— h5p-offline-player`
at the end of the page titles; and the title inside the pack's archives, "H5P Offline Player
library pack", which nobody sees. Changing that one changes
every part's bytes, so every package's `libraries` revision, and every learner's saved state
starts over once; it goes with the next pack release that rewrites every part anyway. The VS Code
extension and the MCP server, "H5P Author MCP by Missing Elements", were named to the rule from
the start. Not decided: the site's address,
`h5p-offline-player.vercel.app`, which names no owner (the policy approves "h5p.terrisblog.com"
and refuses "h5pbootcamp.com"), and the tab title "H5P player" of `/embed` and the embed package's
page, a generic use. Two limits outweigh any name: the automatic licence covers free,
non-commercial use only, so anything paid under an H5P name needs a licence from H5P Group; and
the name may not be used to compete with the H5P Hub or H5P.com.
