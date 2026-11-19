# Security Policy

## Supported versions

Security fixes are made for the current `main` branch and the latest published
versions of the packages in this repository:

| Component | Supported versions |
| --- | --- |
| `@missing-elements/h5p-offline-player` | Latest release and `main` |
| `@missing-elements/h5p-normalize` | Latest release and `main` |
| `@missing-elements/h5p-verify` | Latest release and `main` |
| `@missing-elements/h5p-cmi5` | Latest release and `main` |
| `@missing-elements/h5p-embed` | Latest release and `main` |
| `@missing-elements/h5p-runtime` | Latest release and `main` |
| `@missing-elements/h5p-libraries` | Latest release and `main` |
| `@missing-elements/h5p-author` | Latest release and `main` |
| `@missing-elements/h5p-mcp` | Latest release and `main` |
| Demo and installable app | Deployment from `main` |

Older releases may receive a fix when practical, but users should upgrade to a
supported version. A security fix ships in any release, a patch included; what
a version number promises otherwise is in
[docs/compatibility.md](./docs/compatibility.md).

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do **not** open a public
GitHub issue or Discussion, and do not include a proof of concept in a public
pull request.

Email [alekswebnet@gmail.com](mailto:alekswebnet@gmail.com) with the subject
line `Security report: h5p-offline-player`. Include:

- the affected package, version, and browser or Node.js version;
- a clear description of the impact and affected security boundary;
- steps to reproduce, including a minimal proof of concept where possible;
- whether exploitation requires a malicious `.h5p` archive, a hostile remote
  server, a specific host-page configuration, or user interaction;
- any suggested mitigation or fix.

Do not send real learner data, credentials, access tokens, or proprietary H5P
packages. A minimal synthetic archive or private reproduction link is
preferred.

We aim to acknowledge reports within seven days, provide an initial assessment
within fourteen days, and keep you informed while a fix is investigated.

## Scope

This project processes arbitrary H5P archives, which can contain JavaScript.
The relevant security boundary depends on how the player is deployed:

- The player validates archive entry names and serves entries through a
  Service Worker virtual file server.
- H5P content runs in a same-origin frame. That isolates styling and globals,
  but it does **not** isolate a package played as it is from other data on the
  same origin: its own scripts run there.
- A package played `untrusted` runs none of its own scripts. Its library
  folders and every file in `content/` outside H5P's content file types are
  withheld, its libraries come only from the bundle the host chose, every file
  is served with `nosniff`, the frame's script policy names exact paths, and
  its content is checked against each library's `semantics.json`, as the H5P
  plugins check an upload. [docs/untrusted.md](./docs/untrusted.md) says what
  it covers and what it does not.
- Hosts that play packages they did not make should play them `untrusted`. A
  site with signed-in users should also, or instead, put the player on a
  dedicated origin (the Embed setup).
- The generated frame Content Security Policy limits resource origins, but it
  cannot make a package's own JavaScript safe when the package plays as it is;
  that is what `untrusted` withholds.

The author package and the MCP server build packages from a source that a
model may have written:

- Given `within`, a build reads local files and writes its package only in
  those folders, links followed. Given `publicFetch`, it refuses to download
  from a web address on a local network, redirects included; it resolves a
  name and then asks, so it guards against a mistaken or planted address, not
  a hostile network. A video on YouTube, Vimeo, Panopto or Echo360 is not
  downloaded: its address is kept, and the player loads it wherever it points.
- The MCP server always builds so, in the folders the person gave it, else the
  app's roots, as they are given. Given none, it uses Desktop, Documents and
  Downloads, and never the home folder whole. It never writes over a file, and
  its preview serves one package on `127.0.0.1` until its tab is closed.
- A read (`readPackage`, `h5p-author read`, the MCP server's `h5p_read`) takes
  the archive as untrusted. It writes only the files the content names, only in
  its folder, with every path checked before anything is made, so a link in the
  folder that leads out of it stops the read; never over a file; and it leaves
  out of the source a file named by a path that could lead out of the folder.
  An archive with an entry leading out of its folders is not read.

Reports are particularly helpful for issues such as:

- archive path traversal, package-to-package data exposure, or virtual-route
  access outside the intended package;
- under `untrusted`: any script of the package's own that runs, a file served
  that should have been withheld, or content that should have been removed by
  the content check reaching the page;
- bypasses of the frame CSP, origin checks, message authentication, or
  Service Worker scope boundaries;
- unintended access to host-page data, IndexedDB, cookies, or saved learner
  state;
- cross-origin request, redirect, or navigation-policy bypasses;
- denial of service that defeats documented streaming, size, storage, or
  lifecycle safeguards;
- a build confined by `within` that reads or writes outside its folders or
  writes over a file, `publicFetch` reaching a local network by an address it
  should refuse, a read that writes outside its folder or over a file, or the
  MCP server reaching a file outside its folders;
- vulnerabilities in the published player, runtime, library bundle, normalizer,
  verifier, author package, MCP server, cmi5 package, embed site writer, demo,
  or installable app.

A malicious H5P archive executing its own bundled JavaScript when it plays as
it is, is an expected property of H5P, not by itself a vulnerability. It
becomes a security issue when that code escapes the documented deployment
boundary or gains access it should not have, and under `untrusted` it is one
whenever it runs at all. The known limit in Firefox, described in
docs/untrusted.md, is not a vulnerability by itself.

## Coordinated disclosure

Please allow time for investigation and a fix before public disclosure. We
will work with reporters to agree on a disclosure timeline, credit reporters
who want attribution, and publish release notes or an advisory when doing so
helps users remediate the issue.
