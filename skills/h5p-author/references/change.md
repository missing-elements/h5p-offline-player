# Change a package

The build tool reads a package back into the source a build takes to make it again, with its
pictures, videos and other files beside it. Run step 3's npm check while you read this, then read
the package with the tool of the first route that holds, below for `course.h5p`:

1. The build archive attached (route 1): unpack it as [route 1](./build/archive.md) says, then
   `node h5p-author.mjs read course.h5p read --libraries parts`.
2. npm reaches its registry (route 2): `npx @missing-elements/h5p-author@latest read course.h5p read`.
3. Node runs here (route 3): the type is the `mainLibrary` of the package's `h5p.json`
   (`unzip -p course.h5p h5p.json`, or
   `python3 -c "import zipfile; print(zipfile.ZipFile('course.h5p').read('h5p.json').decode())"`);
   fetch the build tool and that type's bundle as [route 3](./build/two-files.md) says, then run
   route 1's command. A read that stops at a part `parts/` lacks names it (an addon, such as
   H5P.MathDisplay where the text holds math): fetch that part into `parts/` as route 3 says, and
   read again.
4. Anything else: a package cannot be read here. Say so, and offer to make the activity anew.

The read writes `read/course.source.json`, and the files it names beside it. Pass its notes on to
the user: what a source cannot hold, left out. A package made for other versions of its libraries
than the tool's is refused, both named: say so, and offer to make it anew.

Read the type's file, `references/types/<Type>.md`, change the source as the user asked, and keep
the rest as it is. Build it by the same route from `read/`, where its files are, such as
`node h5p-author.mjs build read/course.source.json course-changed.h5p --libraries parts`, then
verify and hand it over as step 4 says.
