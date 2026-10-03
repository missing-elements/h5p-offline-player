# cmi5

cmi5 is xAPI with a launch contract: the LMS opens content by URL, hands it a one-time token
and an LRS to talk to, and the content sends its statements there. It is the integration that
fits this player, for four reasons. The package stays on a static host, since the LMS imports
only a small course structure. The assignable unit can demand its own window, which keeps the
player out of the LMS's iframe and so off the conditions a framed player depends on (see *The
launch*). No LRS credentials sit in page code; the token is per launch. And every statement keeps
`context.revision`, so the LRS knows which build each completion came from.

The alternatives each break one of those. SCORM is the one nearly every LMS supports, but a
SCORM package has to contain the player and the `.h5p` and be hosted inside the LMS, which often
serves it from a content domain in an iframe, bringing those conditions back; and its data model has
no field for the build. LTI 1.3 is how Moodle, Canvas and Blackboard embed external tools, with
grade passback, but it is an OpenID Connect exchange that needs a server holding keys, which a
static host does not have, and it embeds in an iframe by default. Plain xAPI works already, through
the `xapi` event, for a portal the organisation controls, and has no launch contract. What cmi5
does not have is SCORM's reach: some older LMSs support only SCORM.

The element does not change for it. The wiring is a package of its own,
[`@missing-elements/h5p-cmi5`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/cmi5),
with no dependencies: the assignable unit's side of cmi5 is a handful of `fetch` calls, written
there.

## Refreshes and credentials

An H5P package contains same-origin JavaScript, so it must be treated as able to read browser
storage. The cmi5 adapter therefore keeps the LRS token only in memory. A browser refresh is not
a resumable cmi5 launch: the learner returns to the LMS, which starts a new launch with a fresh
one-time token. This is the secure default for arbitrary H5P content.

```js
import '@missing-elements/h5p-offline-player'
import { isCmi5Launch, startCmi5 } from '@missing-elements/h5p-cmi5'

if (isCmi5Launch()) {
  startCmi5(document.querySelector('h5p-player')).then((session) => {
    document.querySelector('#exit').onclick = () => session.exit()
  })
}
```

Its README lists the options. The demo site's `/demo/cmi5.html` is a page built on it,
`demo/cmi5-page.js`, with a log and a status line around those lines. Opened without a launch,
the page explains one and offers `?simulate`: the same code against a stand-in for the LMS
inside the page, every statement shown in the page's log instead of sent, with a mastery score
of 0.8 to pass or fail against.

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

Zip it as `cmi5.xml` and import the zip. For the demo's own page and quiz, the zip is ready:
`apps/demo/demo/cmi5-course.zip`, served by the site as `/demo/cmi5-course.zip` and linked from
the page. It holds only `cmi5.xml`, with the hosted page's address and `OwnWindow` (see
below); `zip cmi5-course.zip
cmi5.xml` rebuilds it after an edit. The LMS appends `endpoint`, `fetch`, `actor`,
`registration` and `activityId` to the URL when a learner opens the course. `?src=` names the
package; `<launchParameters>` in the AU is the alternative, and the page reads it from the LMS
when the URL carries no `src`. The package URL needs CORS headers, as in every setup.

The structure names no `launchMethod`, so it is cmi5's default, `AnyWindow`: the LMS decides
where the page opens, and most put it in a frame of the course page. The player runs there: in
October 2026 a cross-origin frame registered its own Service Worker in desktop Safari 26.6.2, on
iOS 26.6.1 and in Chrome. On Exit the page goes to the launch's `returnURL`, which cmi5 has the
AU do in "the current browser window or frame"; with no `returnURL`, a framed page stays where
it is, since it cannot close the LMS page around it, and the demo page tells the learner to go
back to the course.

`launchMethod="OwnWindow"` makes the LMS open the page top level instead, in a new window or in
place of the course page. Ask for it when a frame would not do:

- the LMS serves its pages over plain `http`, which makes a frame inside them an insecure
  context, with no Service Worker;
- the content needs fullscreen, and the LMS's iframe has no `allow="fullscreen"`;
- learners use iOS before 26, where a framed player has not been tried.

A frame also keeps its storage per LMS site, and Safari may clear the storage of a site the
learner never opens on its own; either costs a download again, not the session. The demo's
`cmi5-course.zip` still asks for `OwnWindow`: it was launched from SCORM Cloud that way, and
it changes once it has been launched there framed.

## What the page sends

1. **`initialized`**, once the token, the launch data and the learner preferences are in.
   Statements the content emits before that wait, since cmi5 wants `initialized` first.
2. **Every provenance-stamped Activity statement the player emits**, as a "cmi5 allowed" statement: the launch actor in
   place of H5P's, the registration, and the LMS's context template merged into the statement's
   own context, so the course grouping and the session id are on it and `context.revision` and
   `context.platform` stay. Where both name a value, the template's wins: cmi5 lets the AU add
   to the template, never overwrite it. H5P's own category, the content type's library, stays too; the cmi5
  category is not added, because that marks a cmi5-defined statement. A statement without both
  provenance fields, or one that is not about an Activity, is reported and dropped.
3. **On the content's completion** — the `finished` event, which H5P raises with the score —
   `passed` or `failed`, then `completed`. With a mastery score in the launch, the score decides;
   without one, H5P's own verdict does, the `success` its pass percentage sets. The score rides
   on `passed` or `failed` only: cmi5 allows it on no other defined statement. Each goes out once
   per registration, not once per session: at startup the page asks the LRS whether an earlier
   session already sent `completed` or `passed`, and sends neither again, nor a `failed` after a
   `passed`. An LRS that will not answer leaves the session to count for itself, which the
   page's log says. In `Browse` and `Review` mode, nothing: cmi5 forbids it.
4. **`terminated`** from the Exit button, which then goes to the launch's `returnURL` or closes
   the window. A learner who closes the tab instead leaves the session open, and the LMS closes
   it: cmi5 has the LMS record `abandoned` for a session that was never terminated. The page does
   not try to send `terminated` as it unloads, because a page cannot tell a closed tab from a
   reload, and a `terminated` sent on a reload ends a session the reloaded page goes on using.

a second `completed`. Every relayed statement carries a UUID id, as cmi5 requires: its own if
The page listens to the element before the handshake starts, since the package loads
meanwhile: anything the content emits before `initialized` has gone out waits, and is sent
after it. The `fetch` URL answers once. Reload recovery is therefore an explicit trusted-host
choice: pass `storage` to `startCmi5()` only when both the package and origin are trusted.
H5P library scripts run in a same-origin frame and can read browser storage, so the default
keeps no LRS token; with it, a reload must be launched again by the LMS. Every relayed statement
carries a UUID id, as cmi5 requires: its own if it has one, a new one if not. A score
on `passed`, `failed` or `completed` carries `min` and `max` beside `raw`, as cmi5 requires;
H5P gives `raw` and `max`, and its minimum is 0. `returnURL` is read from the launch data, where
cmi5 puts it, and followed only if it is an `http` or `https` address: a `javascript:` value
would run in the page when the learner presses Exit. When the LMS refuses a statement, the
page's log shows the reason it gave, which for a cmi5 launching system is the number and text
of the requirement the statement broke.

The content keeps running after completion, and its later statements are still relayed, until
Exit. A learner who retries a quiz is recorded; the `completed` and `passed`/`failed` go out
once. If the LRS rejects the completion, the session keeps its score and verdict for
`session.retry()`; when trusted storage was explicitly enabled, it retries after a reload too.

## Checking it

Conformance is proven against a launching system, not by a library. The check here is ADL's
[CATAPULT](https://github.com/adlnet/CATAPULT) player, the reference cmi5 launching system: it
validates every statement an assignable unit sends against the numbered cmi5 requirements —
the context template, the registration, the session id, the order of `initialized`,
`completed`, `passed` or `failed` and `terminated`, the mastery score — and rejects a statement
that breaks one, naming the requirement. With Docker running:

```bash
pnpm cmi5:catapult            # fetches CATAPULT, starts the player, MySQL and Yet Analytics' SQL LRS,
                              # launches the page headless, answers a question of the real quiz,
                              # completes, presses Exit, prints the verdict
pnpm cmi5:catapult --open     # prints a launch URL for your own browser, waits until you press Exit
pnpm cmi5:catapult --au '<AU URL>'  # launches another page instead of this dev server's
pnpm cmi5:catapult --down     # removes the stack and its data
```

After the first session, the headless run has CATAPULT launch the same registration again, in
Normal mode, and finishes the quiz with a failing score. The script reads both sessions back
from the player and the statements from the LRS, and fails if the sequence is incomplete, if
`initialized` or `terminated` went out other than once per session, if the registration holds a
second `completed` or `passed` or a `failed` after the `passed`, if no statement from the
content itself arrived, or if anything was rejected. In the first session, the quiz's own
`interacted` and `answered` statements carry the package's `revision`, followed by `passed`,
`completed` and `terminated`; the LMS adds `launched` and `satisfied`. In the second session,
only `initialized` and `terminated` go out. The finish of the quiz is the element's
`finished` event dispatched by the script, not four questions played through. CATAPULT is
fetched at a pinned commit and the LRS is a pinned release, the two that passed; the published
ports listen on `127.0.0.1` only. The stack stays up between runs; the first run builds the
player's image, which takes a few minutes. When the page never gets as far as "Launched", the
script prints what it said instead, which is the LMS's refusal with its requirement number.

The fast checks are the package's own unit tests, `packages/cmi5/tests/`, which run the client
against a fake LMS and LRS behind `fetch`, and the wiring against a fake client and a fake
element, in Node; and `apps/demo/tests/cmi5.test.ts`, which launches the demo page in a browser
from a mock LMS and LRS and asserts the sequence above, including that `revision` survives the
merge. `packages/cmi5/tests/requirements.test.ts` holds the package to ADL's list of the
specification's requirements, `@cmi5/requirements`: every one that falls on the assignable unit
is either named next to the test that shows it, shown by the CATAPULT run, left to the host
page or the LMS with the reason, or written down as a gap, and a requirement added to the list
fails the test until someone places it. None is a gap today.

A commercial LMS has launched it too: the hosted page, imported into SCORM Cloud's free tier
from `apps/demo/demo/cmi5-course.zip`, played and recorded there on 2026-10-01. That run was
the build on `@xapi/cmi5`; the client that replaced it has been through CATAPULT, and is worth
one more launch from SCORM Cloud once deployed.

## Testing by hand

Three ways, from the lightest to the most real.

**In the page alone, no LMS.** Open `/demo/cmi5.html` on the dev server and follow the
"simulated launch" link, or go straight to `/demo/cmi5.html?simulate&src=/demo/content/quiz.h5p`.
Answer the quiz and press Exit. The log under the player holds every statement that would have
gone to an LRS, in full: `initialized`, the content's own statements with the launch actor and
the context template merged in, `passed` or `failed` against a mastery score of 0.8, `completed`,
`terminated`. Nothing leaves the page.

**Against the CATAPULT player, in your own browser.** With Docker running:

```bash
pnpm cmi5:catapult --open
```

It brings the stack up if it is not, imports the course, creates a session, prints a launch URL
and waits. Open that URL in any browser: it is a real cmi5 launch with the five parameters
appended, and every request to the player is in the network tab — the token exchange, the
launch data, then each statement. Play the quiz to the end, so that H5P reports completion, and
press Exit. The page goes to the return URL, and the script prints the session as the player
recorded it and the statements the LRS holds, then exits with the verdict. A statement the
player refuses appears in the page's log with the number and text of the requirement it broke.

The SQL LRS's admin UI is at `http://localhost:63390/admin`, user `admin`, password
`admin-password-1`, both set in `apps/demo/cmi5-catapult/docker-compose.yml`; it lists the
statements by registration. A refresh is not another cmi5 launch: its fetch URL is one-time,
and the default integration keeps the token only in memory. Return to the LMS and start a new
launch instead. The stack stays up between runs, so a second launch takes seconds;
`pnpm cmi5:catapult --down` removes it and its data.

**Against another page**, with `--au`: the same flow, with that page as the assignable unit and
the LMS on your machine. The page's own security policy has to let it reach
`http://localhost:63398`, and Chrome asks the person at the keyboard before a public site
reaches a local address ("Access other apps and services on this device"). The hosted demo was
launched this way on 2026-10-01, with that prompt answered, under a policy widened for the run;
the widening is gone, so the hosted page no longer reaches a local player. The same prompt is
what learners would see from a public page whose LMS, LRS or package sits on an internal network,
which is why an organisation with an internal LMS serves the page from an internal host too.

## What it does not do

- It does not turn H5P's interactions into cmi5 interaction statements. H5P's own statements
  carry the answers, and the LRS keeps them as allowed statements.
- It does not apply the learner's audio preference, which cmi5 has the AU apply at startup:
  the element has no audio control. The preference is on the session as
  `learnerPreferences.audioPreference`, for the page to act on.
- It does not keep the content's own progress. cmi5 has no state document for content; the
  player's `resume` attribute keeps it on the device and works alongside if a host sets it.
- It is not SCORM. An LMS without cmi5 needs a SCORM wrapper, which hosts the player and the
  package inside the LMS and has the framing caveat above.
