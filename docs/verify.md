# Checking that a package plays

[`@missing-elements/h5p-verify`](https://github.com/missing-elements/h5p-offline-player/tree/main/packages/verify)
plays a package through the player in a headless browser and says whether it worked:

```bash
npx @missing-elements/h5p-verify course.h5p        # exit 0: it plays; 1: it does not; report.json and a screenshot in course.verify/
```

It names missing libraries, fails on an uncaught error while the runtime boots, and checks that
the content drew something. It is meant as the last step of a pipeline that generates or
rewrites packages; the skill in `skills/h5p-verify/` tells an agent when to run it and how to
read the result.
