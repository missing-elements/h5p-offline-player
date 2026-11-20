# After a build here

## The build's problems and the file's name

A source with a problem writes nothing: the build lists every problem by its path, so fix them
all and run it again under the same name. Once a build has written its file it never writes
over it, so a later build takes a new name (`course-2.h5p`). Copy the one you hand over to the
name the user asked for without writing over a file already there (`cp -n`). If that name is
taken, take a new name and say so. Never delete or overwrite a file
to free a name. Pass the build's notes on to the user: texts left in English, a slide that holds
too much.

## Verify

Where npm reaches its registry (SKILL.md, step 3), run the verifier:

```bash
npx @missing-elements/h5p-verify@latest course.h5p
```

Where it does not, or no browser runs here, the verifier cannot run: the package is
**unverified**, and the user plays it on the build page, as *Hand over* says, before using it.

It writes `course.verify/report.json` and `course.verify/screenshot.png` beside the package
(`--out <folder>` puts them elsewhere). Read the report's `verdict`, `reasons`, `errors` and
`warnings`: a run that fails may say why only in `reasons`, such as content that never reached
ready or drew nothing. Look at the screenshot too: layout mistakes raise no error. One run is
enough: the build already writes what an H5P site's content check keeps, so `--untrusted` finds
nothing more. Where it fails, follow the `h5p-verify` skill's loop if it is installed, and fix the
source, never by removing what fails.

## Hand over

Where commands run on the user's own computer, let them play the package in their browser:

```bash
npx @missing-elements/h5p-verify@latest course.h5p --preview
```

Run it in the background; it ends once its tab has closed. Ask the user to work through all of
it, wrong answers included; its Download button saves a copy. If you already have a browser tool,
add `--no-open` and play the address it prints with that tool. Do not write a browser script to
do it: the person's own play is the check, and a script of your own costs more than the build.

Deliver:

- the `.h5p`, and its source, which the build wrote beside it under the package's name with
  `.source.json` (`course.source.json`): hand over that file, not the one you wrote, copied as
  the package was. Name the files it names, if any: a build reads them beside it;
- this line, as it is but for the source file's name, the only web address you give:

  ```text
  To play it, change it or build it again: open https://missing-elements.github.io/h5p/build/, choose course.source.json under "Or open a file", and press Build.
  ```

  Where the source names files, add that the page asks for them. Give the address with nothing
  after it: a link that carries the source breaks where a chat copies one character of it wrong;
- `screenshot.png` from the run that passed; or that the package is **unverified**; or, where
  it ran and failed, its reasons, and that the package **failed verification**;
- the build's notes;
- what a pass means: it starts and draws, not that it is accurate, accessible or right for every
  LMS;
- that it carries the editor libraries an H5P site's upload check asks for, so a Moodle with no
  library installed accepts it (the one site tried);
- that it carries H5P's libraries, each under its own licence, most MIT, so the user checks those
  terms before they distribute it.
