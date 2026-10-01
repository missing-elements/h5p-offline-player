# @missing-elements/h5p-cmi5

cmi5 for [h5p-offline-player](https://github.com/missing-elements/h5p-offline-player): turns a
page holding `<h5p-player>` into a cmi5 assignable unit, so an LMS can launch an `.h5p` package
and record the learner's result. The package stays on your static host; the LMS imports only a
small course structure that names your page.

What it does, once the LMS opens your page:

- trades the launch's one-time token for LRS credentials and sends `initialized`;
- reads the launch data and the learner's preferences, as the specification requires on
  startup;
- relays every statement the content emits to the LMS's LRS, with the launch actor, the
  registration and the LMS's context template merged in, and the build's `context.revision`
  kept, so the LRS knows which version of the package each result came from;
- when the content finishes, sends `passed` or `failed` by the launch's mastery score, and
  `completed`, once per session;
- sends `terminated` when your Exit button calls `session.exit()`, then returns the learner to
  the LMS.

It has been run against ADL's [CATAPULT](https://github.com/adlnet/CATAPULT) player, the
reference cmi5 launching system, which validates every statement against the numbered
requirements of the specification. Its tests hold every requirement that falls on the
assignable unit, from ADL's own list
([`@cmi5/requirements`](https://www.npmjs.com/package/@cmi5/requirements)), against the test
that shows it, or say why it does not apply. It has no dependencies: the protocol is a few
`fetch` calls, a few kilobytes once a bundler minifies them.

## Usage

```bash
npm i @missing-elements/h5p-offline-player @missing-elements/h5p-cmi5
```

```html
<p id="status" role="status"></p>
<h5p-player></h5p-player>
<button id="exit">Exit</button>
```

```js
import '@missing-elements/h5p-offline-player'
import { isCmi5Launch, startCmi5 } from '@missing-elements/h5p-cmi5'

const player = document.querySelector('h5p-player')

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

`startCmi5` plays the package the page's address names as `?src=`, or the one the course
structure names in `launchParameters`. It resolves once `initialized` is sent, and rejects with
the LMS's reason when the launch fails.

The course structure you import into the LMS, zipped as `cmi5.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="https://your-site.example/courses/quiz">
    <title><langstring lang="en-US">Quiz</langstring></title>
    <description><langstring lang="en-US">A question set</langstring></description>
  </course>
  <au id="https://your-site.example/courses/quiz/au" moveOn="CompletedAndPassed" masteryScore="0.8"
      launchMethod="OwnWindow">
    <title><langstring lang="en-US">Quiz</langstring></title>
    <description><langstring lang="en-US">A question set</langstring></description>
    <url>https://your-site.example/au.html?src=https://your-site.example/quiz.h5p</url>
  </au>
</courseStructure>
```

Keep `launchMethod="OwnWindow"`. It makes the LMS open your page top level. Framed on another
origin, Safari and every browser on iOS give the page no Service Worker, and the player cannot
run without one. The package URL must send CORS headers, as for any use of the player.

## Options

| Option | Default | What it is for |
|---|---|---|
| `onEvent(event)` | none | Told about each step: `initialized`, `sent`, `rejected` with the LMS's reason, `recorded` with `passed` or `failed`, `skipped` in Browse and Review mode, `terminated`, `unsafe-return-url` |
| `src` | the address's `src`, then `launchParameters` | The package to play; `false` leaves the element's `src` to you |
| `storage` | `localStorage` | Where the session is kept across a reload; `null` for nowhere |
| `client` | `createCmi5Client()` on this page's launch | A client of your own: a simulated LMS, a test double |

The session has `terminate()`, `exit()`, which terminates and then goes to the launch's return
address, `stop()`, and the launch's `launchParameters`, `launchData`, `learnerPreferences`,
`returnURL` and `src`.

`createCmi5Client()` is exported too, for a page that wants the protocol without the element:
`initialize()`, `sendXapiStatement()`, `moveOn()` and `terminate()` on the launch in the
address.

## What it takes care of

- **A reload resumes the session.** The launch's token works once, so the package keeps it for
  that launch, with the start time and whether the result went out. A reload sends no second
  `initialized` and no second `completed`, which the specification forbids.
- **Nothing is sent as the page unloads.** A page cannot tell a reload from a closed tab, and a
  `terminated` sent on a reload ends the session the page goes on using. A learner who closes
  the tab without Exit leaves the session for the LMS to record as `abandoned`, which is what
  that verb is for.
- **Statements the content emits before the handshake are held**, and sent after `initialized`.
- **Scores carry `min` and `max` beside `raw`**, as cmi5 requires. H5P reports `raw` and `max`,
  and its minimum is 0.
- **The return address is followed only if it is `http` or `https`.** A `javascript:` value
  would run in your page when the learner presses Exit.
- **Browse and Review launches record no result.**
- **The LMS's context template is never overwritten.** A statement's own context is kept and
  added to, but where it names a value the template also sets, the template's wins.

## What it does not do

It does not apply the learner's audio preference. The specification has the assignable unit
turn audio on or off at startup by it, and the element has no audio control; the preference is
on the session and on the `initialized` event, as `learnerPreferences.audioPreference`, for your
page to act on.

It keeps `completed` and `passed` to once per launch, a reload included, not once per
registration. An LMS that launches the same registration again after a completion receives them
again.

It does not turn H5P's interactions into cmi5 interaction statements. H5P's own statements carry
the answers, and the LRS keeps them as they are. cmi5 has no state document for content, so the
content's own progress is not saved by the LMS; the element's `resume` attribute keeps it on the
device, and works alongside. It is not SCORM.

A working page, with a simulated LMS for trying it without one, is the demo site's
[cmi5 example](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/demo/cmi5-page.js).
The guide, with how the check against CATAPULT is run, is
[docs/cmi5.md](https://github.com/missing-elements/h5p-offline-player/blob/main/docs/cmi5.md).

## Licence

MIT.
