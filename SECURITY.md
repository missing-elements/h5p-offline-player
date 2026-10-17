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
- vulnerabilities in the published player, runtime, library bundle, normalizer,
  verifier, cmi5 package, embed site writer, demo, or installable app.

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
