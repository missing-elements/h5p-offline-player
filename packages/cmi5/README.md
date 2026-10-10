# @missing-elements/h5p-cmi5

cmi5 for [h5p-offline-player](https://github.com/missing-elements/h5p-offline-player): turns a
page holding `<h5p-player>` into a cmi5 assignable unit, so an LMS can launch an `.h5p` package
and record the result. The package stays on your static host; the LMS imports a small course
structure naming your page. No dependencies.

Once launched it sends `initialized`, relays the player's statements to the LMS's LRS with the
launch's actor, registration and context template, sends `passed` or `failed` and `completed`
once per registration when the content finishes, and `terminated` on `session.exit()`.

## Usage

```bash
npm i @missing-elements/h5p-offline-player @missing-elements/h5p-runtime @missing-elements/h5p-cmi5
```

```html
<p id="status" role="status"></p>
<h5p-player></h5p-player>
<button id="exit">Exit</button>
```

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'
import { isCmi5Launch, startCmi5 } from '@missing-elements/h5p-cmi5'

const player = document.querySelector('h5p-player')
player.runtime = runtime

if (isCmi5Launch()) {
  startCmi5(player)
    .then((session) => {
      document.querySelector('#exit').onclick = () => session.exit()
    })
    .catch((error) => {
      document.querySelector('#status').textContent = `The LMS did not answer the launch: ${error.message}`
    })
}
```

`startCmi5` resolves once `initialized` is sent and rejects with the LMS's reason when the launch
fails. It plays the package named by `?src=` in the page's address, or by `launchParameters`.

The course structure, zipped as `cmi5.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="https://your-site.example/courses/quiz">
    <title><langstring lang="en-US">Quiz</langstring></title>
    <description><langstring lang="en-US">A question set</langstring></description>
  </course>
  <au id="https://your-site.example/courses/quiz/au" moveOn="CompletedAndPassed" masteryScore="0.8">
    <title><langstring lang="en-US">Quiz</langstring></title>
    <description><langstring lang="en-US">A question set</langstring></description>
    <url>https://your-site.example/au.html?src=https://your-site.example/quiz.h5p</url>
  </au>
</courseStructure>
```

The package URL must send CORS headers. Add `launchMethod="OwnWindow"` for an LMS on plain `http`,
or for content that needs fullscreen in an LMS iframe without `allow="fullscreen"`. `exit()` goes
to the launch's `returnURL` (followed only if `http` or `https`); with none, it closes a top-level
window, and a framed page stays, so tell the learner to go back to the course.

## Options

| Option | Default | What it is for |
|---|---|---|
| `onEvent(event)` | none | Each step: `initialized`, `sent`, `rejected` (with the LMS's reason), `recorded`, `skipped` (Browse or Review mode, or already recorded), `registration-unread`, `terminated`, `unsafe-return-url` |
| `src` | the address's `src`, then `launchParameters` | The package; `false` leaves `src` to you. On a page anyone can link to, pass `false` and check the package's origin before setting `src` |
| `storage` | `null` | Keeps the session across a reload; only for a trusted package and origin |
| `client` | `createCmi5Client()` | A client of your own, such as a simulated LMS |

The session has `terminate()`, `retry()` for a completion the LRS rejected, `exit()`, `stop()`,
and the launch's `launchParameters`, `launchData`, `learnerPreferences`, `returnURL` and `src`.
`createCmi5Client()` is exported for use without the element: `initialize()`,
`sendXapiStatement()`, `moveOn()` and `terminate()`.

## Behaviour and security

- The LRS token is kept only in memory. A reload is not a resumable launch: the learner returns
  to the LMS for a new one. H5P content runs same-origin and can read browser storage, so pass
  `storage` only when package and origin are trusted; a kept session is reused only for the same
  endpoint, registration and activity.
- Nothing is sent on unload; a tab closed without Exit is the LMS's to record as `abandoned`.
- Statements emitted before the handshake are held until `initialized`.
- Without a mastery score, the content's own `success` decides `passed` or `failed`. Only those
  carry the score, with `min: 0`; `completed` never does.
- If the LRS will not say whether an earlier session already recorded the result, each session
  counts for itself and `registration-unread` is raised.
- Browse and Review launches record no result.
- The learner's audio preference is not applied; it is on the session as
  `learnerPreferences.audioPreference` for your page to act on.
- Content progress is not saved by the LMS; the element's `resume` attribute keeps it on the
  device.

A working page with a simulated LMS is the demo's
[cmi5 example](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/demo/cmi5-page.js);
the full guide is [docs/cmi5.md](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md).

## Licence

MIT.
