# cmi5

cmi5 is xAPI with a launch contract: the LMS opens content by URL, hands it a one-time token
and an LRS, and the content sends its statements there. It suits this player: the package stays
on a static host, the LMS imports only a small course structure, no LRS credentials sit in page
code, and every statement keeps `context.revision`. An LMS that supports only SCORM needs a
SCORM wrapper instead, which hosts the player and the package inside the LMS.

The element does not change for it. The wiring is a package of its own with no dependencies,
[`@missing-elements/h5p-cmi5`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/cmi5):

```js
import '@missing-elements/h5p-offline-player'
import { runtime } from '@missing-elements/h5p-runtime'
import { isCmi5Launch, startCmi5 } from '@missing-elements/h5p-cmi5'

const player = document.querySelector('h5p-player')
player.runtime = runtime

if (isCmi5Launch()) {
  startCmi5(player).then((session) => {
    document.querySelector('#exit').onclick = () => session.exit()
  })
}
```

The options of `startCmi5(player, options)`, detailed in the package's README:

- `onEvent(event)` — told about each step: `initialized`, `sent`, `rejected` (with the LMS's
  reason), `recorded`, `skipped`, `registration-unread`, `terminated`, `unsafe-return-url`.
- `src` — the package to play; by default the address's `?src=`, then the AU's
  `launchParameters`. Pass `false` to set the element's `src` yourself, which a page anyone can
  link to should do after checking the package's origin.
- `storage` — where the session is kept across a reload; default `null`. See *Credentials*.
- `client` — a client of your own, such as a simulated LMS or a test double.

The session has `terminate()`, `retry()` for a completion the LRS rejected, and `exit()`.

The demo's `/demo/cmi5.html` (`demo/cmi5-page.js`) is a page on it. Opened with `?simulate`, it
runs the same code against an LMS simulated inside the page, with a mastery score of 0.8, and
shows every statement in its log instead of sending it.

## Credentials

An H5P package's scripts run on the page's origin and can read browser storage, so by default
the LRS token is kept only in memory. A refresh is not a resumable launch: the `fetch` URL
answers once, and the learner returns to the LMS for a new launch. Pass `storage` only when both
the package and the origin are trusted; a kept session is reused only for the endpoint,
registration and activity it was made under.

## The launch

The course structure names the page and the package:

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
    <url>https://player.example/demo/cmi5.html?src=https://host.example/course.h5p</url>
  </au>
</courseStructure>
```

Zip it as `cmi5.xml` and import the zip. For the demo's page and quiz the zip is ready at
`/demo/cmi5-course.zip` (`apps/demo/demo/cmi5-course.zip`; `zip cmi5-course.zip cmi5.xml`
rebuilds it). The LMS appends `endpoint`, `fetch`, `actor`, `registration` and `activityId` to
the URL. Instead of `?src=`, the AU may name the package in `<launchParameters>`. The package URL
needs CORS headers, as in every setup.

With no `launchMethod`, the LMS chooses where the page opens, usually a frame of the course page;
the player runs there in Chrome, Safari and iOS alike. Set `launchMethod="OwnWindow"` when:

- the LMS serves its pages over plain `http`, which leaves a frame with no Service Worker;
- the content needs fullscreen and the LMS's iframe has no `allow="fullscreen"`.

On Exit the page goes to the launch's `returnURL`, followed only if it is an `http` or `https`
address. With none, a top-level window closes and a framed page stays where it is.

## What the page sends

1. **`initialized`**, once the token, launch data and learner preferences are in. Statements the
   content emits earlier wait for it.
2. **Every Activity statement the player emits**, as a cmi5 allowed statement: the launch actor,
   the registration, and the LMS's context template merged in (the template wins on a conflict),
   with `context.revision` and `context.platform` kept. A statement without both provenance
   fields, or not about an Activity, is reported and dropped. Each carries a UUID id.
3. **On completion** (the `finished` event): `passed` or `failed`, then `completed`. A mastery
   score in the launch decides; without one, H5P's own verdict does. The score, with `min: 0`,
   `max` and `raw`, rides on `passed` or `failed` only. Each goes out once per registration: an
   earlier session's `completed` or `passed` is not sent again, nor `failed` after `passed`. If
   the LRS cannot be asked, the session counts for itself and reports `registration-unread`.
   Nothing is sent in `Browse` or `Review` mode.
4. **`terminated`** from Exit. A closed tab sends nothing; the LMS records the session as
   `abandoned`.

The content's later statements are relayed until Exit. If the LRS rejects the completion,
`session.retry()` sends it again. A refused statement's log entry carries the LMS's reason.

## Checking it

`pnpm cmi5:catapult` runs the page against ADL's
[CATAPULT](https://github.com/adlnet/CATAPULT), the reference cmi5 launching system, which
rejects any statement that breaks a cmi5 requirement and names it. It needs Docker; the first
run builds the player's image, which takes a few minutes.

```bash
pnpm cmi5:catapult                  # headless: two sessions of the quiz, then the verdict
pnpm cmi5:catapult --open           # prints a launch URL for your own browser, waits for Exit
pnpm cmi5:catapult --au '<AU URL>'  # launches another page instead of the dev server's
pnpm cmi5:catapult --down           # removes the stack and its data
```

The LRS's admin UI is at `http://localhost:63390/admin`, user `admin`, password
`admin-password-1`. A page launched with `--au` must be allowed by its own CSP to reach
`http://localhost:63398`, and Chrome asks before a public site reaches a local address.

The unit tests are in `packages/cmi5/tests/` (`requirements.test.ts` places every AU requirement
of `@cmi5/requirements`), and `apps/demo/tests/cmi5.test.ts` launches the demo page from a mock
LMS and LRS.

## What it does not do

- It does not turn H5P's interactions into cmi5 interaction statements; H5P's own statements
  carry the answers.
- It does not apply the learner's audio preference; it is on the session as
  `learnerPreferences.audioPreference` for the page to act on.
- It does not keep the content's own progress; the element's [`resume`](resume.md) does that,
  alongside.
