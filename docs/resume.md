# Resuming where the learner left off

What the `resume` attribute keeps, where, and how a site with its own users keeps it instead
with `resume="host"`.

Without `resume`, the player keeps nothing of what a learner did: close the tab, and the
content starts over. With it, the content picks up where it was:

```html
<h5p-player src="course.h5p" resume></h5p-player>
```

The content then saves its state the way H5P content types do on h5p.com or in Moodle — the
slide reached, the answers given so far, the position in a video, whatever the content type's
`getCurrentState()` returns — every ten seconds, three seconds after a `completed` or
`progressed` statement, and as the frame goes away. The next load of the same package hands it
back. A content type without `getCurrentState()` starts over regardless.

What is stored, and where: the content's own state, as the JSON it produced, in the browser's
storage for the site the player runs on (IndexedDB), on that device. It never leaves the device.
The player sends nothing anywhere, and neither does the content; xAPI statements are still not
stored, with or without `resume`. The state is keyed by the package and the build it was saved
against, the same `revision` the statements carry, so a state from one version of a package is
never handed to another: the content shows H5P's own "This content has changed since you last
used it. You'll be starting over.", and the old state is dropped.

It is off by default because a browser is not a learner: on a shared machine, the state one
person leaves is what the next one finds. And the storage is the site's, not the package's. A
package's libraries are JavaScript running on the site's origin, so any package played on that
site can read what every other package saved there, answers included, and send it wherever
the content can send an image. Play only packages you trust on a site with `resume` on, and do
not open a package from a link's `?src=` without asking first; the demo pages ask before opening
a package from another site. A site that knows its users keeps the state itself
with `resume="host"`, which stores nothing on the device. The element fires `userdata` on every
save; the host keeps the latest `data` per `dataType` and `subContentId`, under its own user and
package, and before the next load of that package sets `userData` to those entries,
`[{ dataType, subContentId, data }]`. With `resume` on the device, `clearUserData()` forgets what
it holds for the package loaded now; set `src` again afterwards to start over. The demo's
[installable app](https://github.com/missing-elements/h5p-offline-player/blob/main/apps/demo/app/app.js)
uses `resume` with a Start over button.
