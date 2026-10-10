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
