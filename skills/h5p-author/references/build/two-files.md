# Build from two files

npm cannot install here, but Node runs and a file can be fetched, as in a sandbox that reaches the
web and no registry. Do not retry npm, try another way to install it, or end with commands for the
user to run once npm works.

Fetch the build tool and the bundle of the source's own `type`, the libraries a build of that type
reads, at the addresses https://missing-elements.github.io/h5p/skill/ lists for them. Where the
sandbox downloads only what a browsing tool has opened, open each address with that tool first,
then download it. In both addresses and commands below, `<type>` is that machine name, such as
`H5P.Blanks`: another type's bundle lacks what this one needs.

```
https://missing-elements.github.io/h5p/bundles/h5p-author.mjs
https://missing-elements.github.io/h5p/bundles/<type>.zip
```

```bash
unzip -q <type>.zip   # or: python3 -m zipfile -e <type>.zip .
node h5p-author.mjs build source.json course.h5p --libraries parts
```

A build that stops at a part `parts/` lacks names it (an addon: H5P.MathDisplay, where the text
holds math): fetch that part into `parts/`, such as
`https://missing-elements.github.io/h5p/bundles/parts/H5P.MathDisplay-1.0.h5p`, and build again.
The verifier cannot run here: hand the package over **unverified**, with the link for the user to
play it before using it.

Where either file cannot be fetched, take the last route of SKILL.md's step 3, the user's browser.

Then follow [After a build here](./built-here.md) to its end: the build's problems, the file's
name, the verifier, the link and the hand-over.
