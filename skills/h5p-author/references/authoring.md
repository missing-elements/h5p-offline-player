# The brief, and good content

## What to settle with the user

Use what the user already gave. Ask for what is missing and matters:

- **The material**: the text, the lesson, the facts. Never invent factual material, and never
  claim an expert reviewed it.
- **Who it is for, and what they should be able to do after**: one objective per activity.
- **The content type**, chosen together (SKILL.md, step 1), and its size: how many questions,
  cards, slides, chapters.
- **The language**, a BCP 47 tag such as `en` or `de-AT`. It sets the libraries' interface
  texts too, from their own translations, which are often incomplete.
- **Media**, for a type that needs them: files the user has, or web addresses they may use,
  with who made them and under which licence.
- **Author and licence**: the author's name, and the licence for the whole, an H5P code: `U`
  (undisclosed, when unknown), `CC BY`, `CC BY-SA`, `CC BY-ND`, `CC BY-NC`, `CC BY-NC-SA`,
  `CC BY-NC-ND`, `CC0 1.0`, `CC PDM`, `GNU GPL`, `PD`, `ODC PDDL` or `C`; `licenseVersion`
  `4.0` for a CC BY one. Never choose a licence the user has not.
- **A pass mark**, for scored content an LMS records, and what a learner who passes or fails
  is told.
- **Where it goes**: an LMS, a website, a file to hand out.

## Writing it well

- Test the objective, with an answer the material supports.
- Wrong answers that a learner who has not understood would choose: plausible, the same length
  and form as the right one.
- Feedback for every answer, wrong ones especially: why, in a sentence, not just "Wrong".
- Plain words, short sentences; one idea per question, card or slide.
- A pass mark with its messages: the failed one says what to do next.
- Alternative text for every picture that carries meaning: what it shows, for a learner who
  cannot see it.

## Media

- Only files the user has or may use; a web address is downloaded into the package at build
  time, so its licence travels with it. A YouTube, Vimeo, Panopto or Echo360 video stays
  there and plays from there, which tells that site who watches. Give the video's own
  address, the one H5P plays: `youtube.com/watch?v=…` or `youtu.be/…` (a Short's is taken as
  its video's), `vimeo.com/` and the number, a Panopto viewer's
  `…/Panopto/Pages/Viewer.aspx?id=…`, Echo360's `echo360.org/media/…/h5p`.
- Pictures: `.png`, `.jpg`, `.gif`, `.bmp`. Video: `.mp4`, `.webm`. Audio: `.mp3`, `.m4a`,
  `.wav`, `.ogg`. H5P takes no SVG or WebP.
- Positions on a picture (hotspots, areas, stages) are guesses until seen: look at the picture
  if you can, and ask the user to check them in the preview.
