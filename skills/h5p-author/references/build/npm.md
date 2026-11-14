# Route 2: with npm

```bash
npx @missing-elements/h5p-author@latest build source.json course.h5p
```

Where it fails to install (`EAI_AGAIN`, `ENOTFOUND`, a registry's 403, 404 or 503, or an install
that hangs until the command times out), the build failed: do not retry it or install it another
way.
