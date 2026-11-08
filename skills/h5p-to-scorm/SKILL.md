---
name: h5p-to-scorm
description: Turn an H5P package (.h5p) into a SCORM zip that an LMS plays, grades and resumes - Moodle, ILIAS, OpenOLAT, Chamilo, SCORM Cloud, Frappe LMS or another that takes SCORM 1.2 or 2004. Use when asked to convert H5P to SCORM, to put H5P content into an LMS as a SCORM package, or to get H5P scores into an LMS gradebook; and after h5p-author when the content is for an LMS. One command writes the zip, with the libraries an export from h5p.com or h5p.org leaves out. No H5P plugin, server or third-party service.
license: MIT
---

# Turn an H5P package into a SCORM zip

`h5p-embed --scorm` writes one `.h5p` as a SCORM zip: the package, the player, the H5P runtime
and a launch page that reports to the LMS. It sends the score out of 100, passed or failed, each
question's answer and the time spent, and saves the learner's place for the next launch where the
content type keeps one (see *Hand over*). Every LMS below records the score, the result, the time
and the place, except Frappe LMS, which records only a pass and the place. An export from h5p.com
or h5p.org, which leaves the libraries out, works too: the zip takes the ones it needs from the
library pack.

The commands need Node 22 or later. Keep `@latest` in them: without it, npm on an older Node
quietly installs the last version that supported it.

## 1. Ask what the zip is for

Ask which LMS it goes to, unless the user has said: it decides the settings to name at the end,
and whether the options below were checked there. Each of these has a default:

- **Pass or fail.** By default the content's own verdict counts, such as a Question Set's pass
  percentage. `--pass-mark 80` makes 80 and above pass and anything below fail, whatever the
  content says. Frappe LMS marks a lesson done only on a pass, so there a quiz needs one.
- **Content that finishes without a score.** A questionnaire, or a branching scenario without
  scoring, ends `completed` with no score; `--completion-score` records it as 100, for a
  gradebook that needs a number, and with a pass mark it passes. An Accordion, a Virtual Tour, or a
  presentation or book with no questions in it never finishes at all, and stays `incomplete` with
  or without it: the LMS should complete such an activity on viewing.
- **SCORM 2004** (`--scorm-version 2004`) only when the LMS asks for it, or a failed attempt
  should still count as completed. Otherwise 1.2, the version checked in every LMS below.
- **The title** the LMS lists it by is the package's own, unless `--title "<text>"` gives another.

For a plain quiz, the defaults fit: ask about nothing but the LMS.

## 2. Check that the package plays

    npx @missing-elements/h5p-verify@latest course.h5p --libraries pack --no-refresh-libraries --no-downgrade-libraries

These options play it as the zip will: the libraries it carries as they are, the ones it lacks
from the pack, and none older than the content was made for. Exit 0 is a pass. Exit 1 means
the package does not play, and the summary says why: read it with the h5p-verify skill, if it is
installed, and fix the package before going on. Exit 2 means the check could not run, for want of
a browser or of a file at that path: fix that and run it again, or, where it cannot run, write
the zip and tell the user the package is unchecked. Never change the package for an exit 2. A
package h5p-author has just built and checked needs no second check.

## 3. Write the zip

    npx @missing-elements/h5p-embed@latest --scorm course.h5p
    npx @missing-elements/h5p-embed@latest --scorm course.h5p course-80.zip --pass-mark 80
    npx @missing-elements/h5p-embed@latest --scorm course.h5p --scorm-version 2004 --completion-score

The first writes `course.scorm.zip` in the current folder; a name after the package writes that
file instead, into a folder that already exists. It reads the whole package before it writes, and
ends with what it wrote: the zip and its size, the title, the SCORM version, the options, and the
libraries it took from the pack. If it refuses:

| It says | What to do |
|---|---|
| `needs libraries that neither it nor the library pack carries: …` | The package was made with a library, or a version of one, that the pack does not have. Export it with its libraries from a tool that carries them, such as Lumi or the H5P plugin of Moodle, WordPress or Drupal, and write the zip from that |
| `… exists. Pass --force to replace it.` | Give another name, or add `--force` once the user agrees to replace the file |
| `No such file: …` | The path is wrong, or the command ran in another folder: check both before asking the user for the file |
| `it is not an H5P package`, `could not be read as a zip archive`, `names no libraries` | Not a playable `.h5p`: ask the user for the file again |
| `The pass mark is a number from 0 to 100` | Give a number, such as `--pass-mark 80` |

## 4. Hand over

Give the user the zip and the way into their LMS:

| LMS | Add the zip as | Change from the defaults | SCORM 2004 and the grading options |
|---|---|---|---|
| Moodle 4.5 | a SCORM package activity | nothing; keep the maximum grade at 100 | checked |
| ILIAS 11 | a SCORM learning module | turn Learning Progress on in Administration, then in the module's Learning Progress choose "Collection of SCORM Items" and tick the item; without it ILIAS drops every score | not yet |
| OpenOLAT 21.1 | a "SCORM 1.2" course element | set "Score needed to pass" to the pass mark, or choose "Transfer passed value", since otherwise every result passes; in a learning path, choose "Passed" as the completion criterion | not yet |
| Chamilo 3.0 | an imported learning path | publish the learning path | not yet |
| SCORM Cloud | a course | nothing | checked |
| Frappe LMS, `develop` | a SCORM chapter | nothing; the content needs a pass mark, and Frappe keeps no score | not yet |

Each was checked at that version, as a learner in Chrome. Another LMS that takes SCORM 1.2 is
likely to work but has not been tried: say so, and suggest a test course first.

Tell the user, too:

- The LMS must be served over https, since the player needs a Service Worker.
- The package's own code runs on the LMS's site, as every SCORM package's does: make zips only
  of packages the user trusts as much as any other SCORM package they upload.
- How to try it: launch it as a student, answer one question wrong and the rest right, and check
  the score and the status in the gradebook; then leave halfway through and launch it again.
- The next launch continues where the learner was only for a content type that saves its place,
  as Question Set, Course Presentation, Interactive Book, Interactive Video, Branching Scenario
  and most single questions do. An Accordion, Image Hotspots, Flashcards or a Timeline starts over
  at every launch, as on any H5P site.
- SCORM 1.2 keeps 4,096 characters of saved state, of which a quiz takes about 200 and a
  twelve-chapter Interactive Book about 1,000. A state that does not fit is not saved, and the
  page says so under the content; SCORM 2004 keeps 64,000.
- A zip written again from another `.h5p` starts learners over: their saved place belongs to
  the package it was saved in.

Someone who will convert files without a terminal, or many at once, can use the page that builds
the same zips in the browser, with nothing uploaded:
https://h5p-offline-player.vercel.app/demo/scorm.html

## What a pass here does not prove

You can check that the package plays and that the zip was written, not that the LMS records what
it should: no LMS runs here. Say what was checked and no more. Where an LMS serves the zip whole
rather than in ranges (ILIAS, Chamilo, Frappe LMS), a large video in it starts only once the
download has reached it.
