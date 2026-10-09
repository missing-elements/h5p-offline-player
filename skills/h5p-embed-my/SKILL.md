---
name: h5p-embed-my
description: Embed an H5P activity (.h5p) on any web page with nothing installed, through Embed My (embed-my.org), a free service built on h5p-offline-player. Use when asked to put H5P content on a blog, a page builder, a CMS, a documentation site, an LMS page or a portfolio, on any site with signed-in users or packages it did not make, or for an iframe snippet for an H5P package. Covers the package URL to check, the snippet, where to paste it, the xAPI relay and what the service is not.
license: MIT
---

# Embed an H5P activity with Embed My

[Embed My](https://embed-my.org/) turns a link to a `.h5p` file into an iframe snippet. The
activity runs on Embed My's origin in h5p-offline-player, with no server, no account and no
file on the user's site: the page carries an `<iframe>` and one script line that sizes it. It is
the safe default: a package is JavaScript, and embedded it runs on Embed My's origin, where it
cannot reach the site's page, cookies, storage or APIs. Use the `h5p-player-setup` skill to
install the player on the site instead only when the site needs the element's own API —
results with the learner's identity to its backend, `resume="host"`, cmi5, a file picker — and
plays only packages its own team made, or when it must keep every request on its own domain.

## 1. Check the package URL

Embed My stores nothing. It plays the package from the URL in the snippet, so that URL must:

- point at the `.h5p` file itself, over `https://`, with no login: a download page, a cloud
  drive's share or preview link, or a page inside an LMS does not work;
- send CORS headers, because the frame on `https://embed-my.org` fetches it, not the page
  around it;
- ideally honour `Range`, so a large package starts after a few kilobytes instead of
  downloading whole.

```bash
curl -sI -H 'Range: bytes=0-0' https://host.example/activities/week-1-quiz.h5p
```

Look for `access-control-allow-origin` (required) and `206` (recommended). GitHub Pages meets
both as it comes. A file on Google Drive, Dropbox or OneDrive does not; put it on a host where
the user controls the headers.

An export from h5p.com or h5p.org usually contains only `content/` and no libraries. Such a
package needs a library source: add `&libraries=hub` to the address for the H5P hub, or
`&libraries=<url>` for a bundle — `@missing-elements/h5p-libraries` on jsDelivr
(`https://cdn.jsdelivr.net/npm/@missing-elements/h5p-libraries@0/libraries.h5p`, every hub
content type's libraries, encoded as a value) or one the user hosts.

## 2. Write the snippet

The user can make it on https://embed-my.org/ — paste the link, preview, tick the options,
copy — and that is the right answer for someone who will paste it themselves. To write it for
them:

```html
<iframe
  src="https://embed-my.github.io/h5p?src=https://host.example/activities/week-1-quiz.h5p&frame&copyright&export"
  title="Week 1 knowledge check"
  loading="lazy"
  allow="fullscreen"
  style="width: 100%; min-height: 540px; border: 0"
></iframe>
<script src="https://embed-my.github.io/h5p-resizer.js"></script>
```

The address is `https://embed-my.github.io/h5p` on purpose, not embed-my.org: the project keeps
the GitHub Pages address for as long as it is on GitHub, and it forwards to the domain, so a
snippet outlives the domain. Keep it as written.

Parameters on the address, after `src`:

| Parameter | Effect |
|---|---|
| `src=<url>` | the package, required; encode `&`, `#`, `+`, `%` and spaces in it (`:` and `/` can stay) so a URL with its own query string arrives whole |
| `frame`, `copyright`, `export` | H5P's own bar under the content, with its Rights of use button (the licences in the package) and its Reuse button (download). `frame` holds the buttons: add it with either, leave all three out for no bar |
| `icon`, `reporting`, `fullscreen=off` | the H5P logo in the bar; content types that report; no fullscreen button |
| `libraries=hub` or `libraries=<url>` | libraries for a package that has none, see section 1 |
| `preload=auto` | start fetching the media at once, for a video that would otherwise wait |
| `activity-id=<IRI>` | the object id every xAPI statement names, instead of the package URL |
| `custom-css=<url>` | a stylesheet of the user's, loaded into the content |
| `xapi=<origin>` | relay statements to the page around the frame, see section 5 |

Not available on the address, by design: a custom script and a learner's name. Those belong
to a site that hosts the player itself.

On the iframe: `title` is what screen readers announce, so name the activity, not "H5P";
`allow="fullscreen"` lets H5P's fullscreen button work; `loading="lazy"` is fine. The
`min-height` is only for a site that strips the script, where the frame keeps that height.

The script line is the only code that runs on the user's page. It answers the frame's height
reports and sets the iframe's height, nothing else; without it the frame stays at the height
in `style` and anything taller scrolls inside it. A page that already has h5p.org's
`h5p-resizer.js` for its h5p.org embeds needs no second one: same protocol, same effect.

## 3. Where it goes

Paste the snippet into the platform's HTML block: Custom HTML in WordPress, Embed in
Squarespace, Wix or Google Sites, HTML in Moodle's text editor with the HTML view on. Blocks
that accept only a URL take the iframe's `src` alone; the frame then keeps the height from
`style`, so set `min-height` to fit the activity. A page that strips `<script>` behaves the
same way.

Three things about the page itself:

- It must be served over `https://` (or `localhost` while developing). On `http://` the frame
  is an insecure context, has no Service Worker, and plays nothing.
- A Content Security Policy on the site must allow the frame: `frame-src
  https://embed-my.github.io https://embed-my.org`, both, since the address forwards from one to
  the other. If the site cannot allow an iframe, link to the activity's address instead; it
  opens on its own.
- In-app browsers inside social and messaging apps sometimes give a frame no Service Worker.
  The frame then shows a link that opens the activity on its own page; nothing to do.

## 4. Check it

Open the published page in a private window and confirm:

1. The activity appears, not a spinner, a blank frame or a notice in the frame.
2. The iframe is the height of the content and grows when the content does (open a question,
   a dialog, a longer slide): that is the script working.
3. Interactions, media and the fullscreen button work.
4. A large video starts in an acceptable time on an ordinary connection; if it takes minutes,
   the package is the cause, see the table.
5. Someone not signed in to the authoring system can use it: the package URL is public.

Before publishing a package that was generated or rewritten, `npx @missing-elements/h5p-verify
course.h5p` plays it headless and reports whether it works (the `h5p-verify` skill).

## 5. Results

Embed My puts no score in a gradebook and keeps no learner record; a standard embed is an
ungraded activity, and a reload starts it over. For results, the page around the frame has to
listen. Add `&xapi=<the page's origin>` to the address, for example
`&xapi=https://courses.example.edu`, and the frame posts every statement to that origin and to
no other:

```js
const frame = document.querySelector('iframe')
addEventListener('message', ({ source, origin, data }) => {
  // The frame's origin is embed-my.org, where the snippet's address forwards.
  if (source !== frame.contentWindow || origin !== 'https://embed-my.org') return
  if (data?.context !== 'h5p-offline-player') return
  if (data.action === 'xapi') send(data.statement)      // every statement, data.verb beside it
  if (data.action === 'finished') send(data.statement)  // the final one, with result.score
})
```

The origin and source checks prove where a message came from, not what it says: the content
produces each statement, and a package can post any score. Treat relayed results as the
learner's report, which is what xAPI from a browser always is, not as proof for a grade.

Each statement carries `context.revision`, a fingerprint of the package build, and
`context.platform`, the player's version, so a completion can be tied to the build the learner
played. Where that goes — an LRS, the site's own backend — is the user's integration, and
personal data in it needs the learner's consent. For an LMS that should launch and grade the
activity, cmi5 with a self-hosted player is the fit, not an embed; see the player's cmi5 guide.

## 6. When it does not work

| Report | Cause | Fix |
|---|---|---|
| the frame says the package cannot be fetched | not a direct `.h5p` URL, no CORS headers, an expired link, a login | section 1; host the file where the headers can be set |
| "contains no libraries", or the preview says libraries are missing | an h5p.com / h5p.org export | `&libraries=hub`, or a complete export from the authoring tool |
| the activity is cut off, or leaves blank space below | the script line is missing or was stripped | use the platform's HTML or embed block; failing that, set `min-height` to fit |
| nothing plays, and the page is `http://` | no Service Worker in an insecure context | serve the page over https |
| the frame is blocked, console names `frame-src` | the site's CSP | allow both Embed My origins, section 3 |
| a video takes minutes to start, then plays | the package: the video is compressed inside the zip, or its index is at the end | the publisher runs `npx @missing-elements/h5p-normalize course.h5p` once (the `h5p-normalize` skill) |
| the frame shows "open it on its own" | an in-app browser without a Service Worker for frames | expected; share the link |
| the activity works in the LMS but not here | the LMS supplied the libraries, the export does not carry them | re-export complete, or `&libraries=hub` |
| statements never arrive on the page | `xapi=` names a different origin than the page's, or the listener checks the wrong one | `xapi` is the page's exact origin; the message's origin is `https://embed-my.org` |

## 7. Hand over

Tell the user what they are getting. The activity runs on Embed My's origin, a free, open
service with no accounts, cookies or tracking; browsers keep its storage separate per
embedding site, so a package is downloaded once per site that embeds it. Only the package URL
is in the snippet, so it is not secret, and a package runs its own scripts: embed only
packages the user would run as a script on their own site. The player inside is
h5p-offline-player (MIT) around the H5P core runtime (GPL-3.0). Results are the page's to
collect, section 5, or there are none. If the service ever stops, the frame shows an error and
the page around it is unaffected; the player is open source, so the same page can be
self-hosted and the snippet pointed at it.

Embed My's own guides, for the user to keep: embedding, hosting packages, results and xAPI,
accessibility, privacy and security, troubleshooting, all at
https://github.com/embed-my/.github/tree/main/docs.
