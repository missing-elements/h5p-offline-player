# What the frame is allowed to reach

The content runs under a generated Content Security Policy. This is what it allows, how a host
adds an origin of its own with `allow-origins`, and why `'unsafe-eval'` is in it.

The frame runs untrusted content under a generated CSP. Media, images and iframes are open, so
embedded video works; scripts are same-origin plus a short list of what content types genuinely
load at runtime — MathJax for H5P.MathDisplay, Google's WebFont loader, and the YouTube, Vimeo
and Panopto player APIs that H5P.Video puts in the document before it embeds anything.

For a host the list cannot know about — a tenant's own Panopto or Echo360 server, an in-house
CDN — `allow-origins` adds it:

```html
<h5p-player src="…" allow-origins="https://tenant.panopto.com https://cdn.corp.example"></h5p-player>
```

It only ever adds hosts. Anything that is not plainly a host is dropped, so a stray value cannot
append directives of its own. A blocked resource names its directive and origin in the console.

The policy allows `'unsafe-eval'`. Packages that bundle EmbeddedJS — board games, older question
sets — compile their templates with `eval` and render nothing without it. It gives an attacker no
reach the archive's own scripts lack: those are served from the frame's origin and already run
under `'self'`, so anyone who can put a file in the package can already run what they like. What
the policy is for is limiting where code and data can come *from*, and this does not widen that.
