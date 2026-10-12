# What the frame is allowed to reach

The content runs under a generated Content Security Policy. Media, images and iframes are open.
Scripts are same-origin plus what content types load at runtime: MathJax, Google's WebFont
loader, and the YouTube, Vimeo and Panopto player APIs.

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
- the YouTube, Vimeo and Panopto player APIs, each by path.

`'self'` is not in it: the frame shares your origin, and `'self'` would let markup a package
injects load any script on your site. Nor are jsDelivr, cdnjs and Google's WebFont loader, since
a CDN serves any file on npm or GitHub; an old Arithmetic Quiz falls back to its own fonts, and
H5P.MathDisplay has carried MathJax in its own folder since 1.0. `allow-origins` still adds hosts.

The worker serves such a package's `content/` only in H5P's own list of content file types —
images, audio, video, fonts, documents, subtitles, JSON — and never scripts, stylesheets, HTML,
SVG or XML. Every response carries `X-Content-Type-Options: nosniff`, so no content file runs as a
script even under the package's own path.
