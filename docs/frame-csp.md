# What the frame is allowed to reach

The content runs under a generated Content Security Policy. Media, images and iframes are open.
Scripts are same-origin plus what content types load at runtime: MathJax, Google's WebFont
loader, the YouTube, Vimeo and Panopto player APIs, and, by path, the endpoints Timeline reads
its Wikipedia, Vimeo, SoundCloud and Flickr items from. Requests from script are same-origin,
with one exception, by path: the oEmbed record Vimeo's player reads before it can start.

Inline scripts never run, in either policy: every script the frame loads carries a nonce, so a
`<script>` in content markup is refused. One content type is refused with it: AR Scavenger
injects A-Frame and AR.js as inline scripts of its own making, so it shows its title and nothing
more. See [Troubleshooting](troubleshooting.md).

For an origin the list cannot know about — a tenant's Panopto or Echo360 server, an in-house CDN
— `allow-origins` adds it:

```html
<h5p-player src="…" allow-origins="https://tenant.panopto.com https://cdn.corp.example"></h5p-player>
```

It only adds hosts; anything else is dropped. A blocked resource names its directive and origin
in the console.

The policy allows `'unsafe-eval'`, because packages that bundle EmbeddedJS render nothing without
it. It adds no reach: the package's own scripts already run as `'self'`.

## An untrusted package

With `untrusted`, the policy names script paths, not origins:

- the package's own path on the virtual file server, which then serves library code only from the
  `libraries` bundle, never from the package;
- the runtime's files and your `custom-js`, each by exact URL;
- the YouTube, Vimeo and Panopto player APIs, and Timeline's media endpoints, each by path.

`'self'` is not in it: the frame shares your origin, and `'self'` would let markup a package
injects load any script on your site. Nor are jsDelivr, cdnjs and Google's WebFont loader, since
a CDN serves any file on npm or GitHub; an old Arithmetic Quiz falls back to its own fonts, and
H5P.MathDisplay has carried MathJax in its own folder since 1.0. `allow-origins` still adds hosts.

The worker serves such a package's `content/` only in H5P's own list of content file types —
images, audio, video, fonts, documents, subtitles, JSON — and never scripts, stylesheets, HTML,
SVG or XML. Every response carries `X-Content-Type-Options: nosniff`, so no content file runs as a
script even under the package's own path.

The policy refuses inline scripts and handlers in every case, since its scripts carry a nonce, so a
`<script>` in a content field never runs, nor does an `onerror` or a `javascript:` link. Markup
needs no script to do harm, though: a form asking for a password, a frame, a style laid over the
page. With `untrusted` the runtime therefore checks the content against each library's
`semantics.json` before it is shown, as the H5P CMS plugins do; [Packages you did not
make](untrusted.md) describes the check.
