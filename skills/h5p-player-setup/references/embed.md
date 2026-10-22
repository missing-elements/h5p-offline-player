# Embed: a player page on a domain the organisation runs

The player page is a static site that `@missing-elements/h5p-embed` writes:

```bash
npx @missing-elements/h5p-embed@latest h5p-player --packages https://host.example
```

It needs Node 22 or later. Keep `@latest`: without it, npm on an older Node quietly installs the
last version that supported it, which writes a player from before 1.0.

`--packages` limits the hosts packages may come from (add `https://cdn.jsdelivr.net` for
`libraries=pack` on a site built with `--no-libraries`), `--ancestors` the sites that may frame the page; leave both out to allow any.
Deploy the folder to a domain of the organisation's own: a separate registrable domain
(`h5p-player.example.net`, not a subdomain of the site, which would receive its cookies) that
holds nothing else — no accounts, no cookies. The folder carries the headers for whatever
serves it: a `Caddyfile`, an `nginx.conf` and an `.htaccess` for a server of the organisation's
own (a Hetzner or OVH box, a university's Apache), `_headers` for Netlify and Cloudflare Pages,
`vercel.json` for Vercel; on GitHub Pages or object storage, which set no headers, the page's
own `<meta>` policy applies and `--ancestors` does not. The site's page then carries:

```html
<iframe src="https://h5p-player.example.net/?src=https://host.example/activities/week-1-quiz.h5p&frame&copyright&export"
        title="Week 1 knowledge check" loading="lazy" allow="fullscreen; microphone; camera"
        style="width: 100%; min-height: 540px; border: 0"></iframe>
<script src="https://h5p-player.example.net/resizer.js"></script>
```

The script line sizes the iframe to the content; a page that already has h5p.org's
`h5p-resizer.js` needs no second one. `title` is what screen readers announce, so name the
activity; `min-height` is for a platform that strips the script. Encode `&`, `#`, `+`, `%` and
spaces inside `src`. Parameters, by the element's attribute names: `libraries=pack` or
`libraries=<url>` for a package without libraries (`libraries=none` turns off the site's default), `preload=auto`, `frame`, `copyright`,
`export`, `icon`, `reporting`, `fullscreen=off`, `activity-id=<IRI>`, `custom-css=<URL>`,
`lang=<the page's language>` for H5P's own buttons and dialogs in a package that does not name its
own language (one that does gets them in that language), and `xapi=<the page's origin>` to
receive statements by `postMessage`. Not `custom-js` or `user`.

Paste it into the platform's HTML block (Custom HTML in WordPress, Embed in Squarespace, Wix or
Google Sites, HTML view in Moodle). The embedding page must be https (or localhost); the frame
registers its own worker there, in Safari and on iOS too. A CSP on the site needs `frame-src
https://h5p-player.example.net`. With `xapi=`, listen for the relay and check where it came from:

```js
const frame = document.querySelector('iframe')
addEventListener('message', ({ source, origin, data }) => {
  if (source !== frame.contentWindow || origin !== 'https://h5p-player.example.net') return
  if (data?.context !== 'h5p-offline-player') return
  if (data.action === 'xapi') send(data.statement)      // every statement
  if (data.action === 'finished') send(data.statement)  // the result, with result.score; the last one counts
})
```

Those checks prove the sender, not the score: any package can post any statement, so relayed
results are the learner's report, not proof for a grade.

Do not embed from the demo site, or from any public service, in production: every learner's
browser would connect to an origin the organisation has no data processing agreement with, which
a GDPR or security review will not pass.

For the site's privacy notice, or a reviewer's questions about what is stored, what is sent and
to whom: https://github.com/missing-elements/h5p-offline-player/blob/main/docs/privacy.md
