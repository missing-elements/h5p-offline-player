# Build with npm

npm reaches its registry here, as in a terminal:

```bash
npx @missing-elements/h5p-author@latest build source.json course.h5p
```

Where it cannot install after all (`EAI_AGAIN`, `ENOTFOUND`, a registry's 403, 404 or 503, or an
install that hangs until the command times out), do not retry, try another way to install it, or
end with commands for the user to run once npm works: take the next route of SKILL.md's step 3.

Then follow [After a build here](./built-here.md) to its end: the build's problems, the file's
name, the verifier, the link and the hand-over.
