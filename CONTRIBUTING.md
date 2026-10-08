# Contributing

Thank you for contributing to `h5p-offline-player`.

## Before you start

This repository is a pnpm workspace containing the player, normalizer,
verifier, cmi5 package, and demo application. Read the
[development guide](./docs/development.md) before making changes. It explains
the workspace layout, generated assets, and the commands that apply to each
package.

The player handles untrusted archives across a page, Service Worker, and
dedicated worker. For architectural constraints and security boundaries, read
[h5p-offline-player-architecture.md](./h5p-offline-player-architecture.md).

## Prerequisites

- Node.js 22 LTS or 24 LTS
- pnpm 10
- Chromium for browser tests

## Local setup

```bash
git clone https://github.com/missing-elements/h5p-offline-player.git
cd h5p-offline-player
pnpm install --frozen-lockfile
pnpm --filter @missing-elements/h5p-offline-player exec playwright install chromium
```

## Development and verification

Start the demo development server:

```bash
pnpm dev
```

Run the checks that cover your change:

```bash
pnpm test:unit
pnpm test:browser
pnpm typecheck
pnpm build
```

`pnpm test:browser` exercises the player in Chromium, including its Service
Worker and Jobs worker. Run it for changes to playback, storage, worker,
network, or browser-facing behavior. Run the smallest relevant check first,
then expand coverage when the change affects more than one package.

Do not commit generated `dist`, `public/frame-assets`, the runtime's `index.js`,
or fixture output unless the repository's existing release or asset-generation
workflow explicitly requires it.

## Pull requests

Before opening a pull request:

1. Keep the change focused and add or update tests for behavior changes.
2. Run the relevant checks and state the commands and results in the pull
   request.
3. Update documentation when a public API, deployment requirement, security
   boundary, or user-visible behavior changes.
4. Preserve streaming behavior: do not introduce whole-archive or whole-media
   buffering.
5. Preserve archive-name validation, origin checks, Service Worker boundaries,
   and the frame Content Security Policy.
6. Preserve keyboard accessibility and visible focus behavior when changing
   the player, frame, demo, or installable app.
7. Do not disclose security vulnerabilities in public issues or pull requests;
   follow [SECURITY.md](./SECURITY.md) instead.

Describe the problem, the solution, and how you verified the change. Include a
screenshot, recording, or minimal reproduction when it helps reviewers assess
a user-visible change.

