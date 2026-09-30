# Checking that a package plays

A zip that opens and JSON that parses prove nothing; most broken packages are valid zips that
fail in the runtime. [`@missing-elements/h5p-verify`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/verify)
plays a package through the player in a headless browser and says whether it worked:

```bash
npx @missing-elements/h5p-verify course.h5p        # exit 0: it plays; 1: it does not; report.json and a screenshot beside it
```

It names the libraries a package lacks, fails on an uncaught error while the runtime boots, and
checks that the content drew something. Made for the last step of a pipeline that generates or
rewrites packages — an AI agent's included: the repository ships a skill (`skills/h5p-verify/`),
which tells an agent when to run it and how to read the result.
