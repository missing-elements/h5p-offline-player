# Checking that a package plays

[`@missing-elements/h5p-verify`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/verify)
plays a package through the player in a headless browser and says whether it worked. It needs
Node 22 or later:

```bash
npx @missing-elements/h5p-verify@latest course.h5p        # exit 0: it plays; 1: it does not; 2: it could not run. report.json and a screenshot in course.verify/
```

It names missing libraries, fails on an uncaught error while the runtime boots, and checks that
the content drew something. With `--untrusted` it plays the package as a site that did not make
it will, [untrusted](untrusted.md), against the library pack, and lists as warnings what the
content check removes from each field: markup, attributes and styles by name, fields, values.
With `--libraries pack`, or a copy of the pack's `parts/`, it plays a library the package carries
at the pack's newer version, as a site with the pack will, and says which. Content made for a
newer minor version than any source has plays at the newest older one, as the player does by
default, with a warning for each library; `--no-downgrade-libraries` fails it instead. It is
meant as the last step of a pipeline that generates or rewrites packages; the skill in
`skills/h5p-verify/` tells an agent when to run it and how to read the result.

The check cannot say whether the content is right; a person decides that by playing it.
`--preview` checks nothing and opens the package in the real player in the person's own
browser, served from their computer with `Range`, as a static host serves it. It works for any
content type, and a large video starts at once. Its page has a Download button for the file. It
ends a few seconds after its last tab closes:

```bash
npx @missing-elements/h5p-verify@latest course.h5p --preview
```

In VS Code, Cursor or VSCodium, the
[H5P Preview extension](https://marketplace.visualstudio.com/items?itemName=MissingElements.h5p-preview)
does the same in an editor tab, and plays the file again whenever it is rewritten; it carries the
library pack, so an export without its libraries plays offline.

For authoring, the
[`h5p-author` skill](https://github.com/missing-elements/h5p-offline-player/tree/main/skills/h5p-author)
adds a prompt-to-quiz workflow and a portable packaging helper for text-only Multiple Choice
and Question Set. It takes a small quiz JSON file, fills the installed libraries' defaults,
includes their runtime dependencies, then requires this playback check and screenshot review,
and opens the quiz in the preview for a person to answer every question. The source JSON remains
editable; the `.h5p` and full revision from the verification report identify what was checked.
Answer accuracy and a complete question-by-question interaction check remain separate from the
verifier's startup verdict.
