# Build from the build archive

The user attached `h5p-author-build.tar.gz`: the build tool and every type's libraries in one
file. Find it in the folder the chat keeps attachments in
(`find / -name 'h5p-author-build*.tar.gz' 2>/dev/null`), unpack it in your working folder and
build from it: nothing to install or fetch, for any type.

```bash
tar -xzf <archive>   # or: python3 -m tarfile -e <archive> .
node h5p-author.mjs build source.json course.h5p --libraries parts
```

With no network, a file's `path` must name a file here, such as one the user attached: a web
address is downloaded as it builds. Where npm cannot install, the verifier cannot run either,
which its command finds out in ten seconds: hand the package over **unverified**, with the link
for the user to play it before using it.

Where it cannot build here after all, take the next route of SKILL.md's step 3.

Then follow [After a build here](./built-here.md) to its end: the build's problems, the file's
name, the verifier, the link and the hand-over.
