# Route 3: from two files

Fetch the build tool and the bundle of the source's own `type`, the libraries a build of that type
reads, at the addresses https://missing-elements.github.io/h5p/skill/ lists. Where the sandbox
downloads only what a browsing tool has opened, open each address with that tool first. Where a
file does not arrive, this route has failed. Below, `<type>` is that machine name, such as
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
