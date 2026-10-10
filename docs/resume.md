# Resuming where the learner left off

Without `resume`, the player keeps nothing: close the tab and the content starts over. With it,
the content picks up where it was:

```html
<h5p-player src="course.h5p" resume></h5p-player>
```

The content saves what its `getCurrentState()` returns — the slide reached, the answers given,
the position in a video — every ten seconds, three seconds after a `completed` or `progressed`
statement, and as the frame goes away. A content type without `getCurrentState()` always starts
over.

**Where it is stored.** In IndexedDB, in the browser's storage for the site the player runs on,
on that device. Nothing is sent anywhere, and xAPI statements are not stored either way. The
state is keyed by the package and its [`revision`](revision.md); a state saved against another
build is dropped, and H5P tells the learner the content has changed.

**Privacy.** It is off by default: on a shared machine, one person's state is what the next
finds. With it on, the content's state, answers included, sits in that origin's browser storage,
and any package played on the site can read what every other package saved there and send it
out. Play only packages you trust on a site with `resume` on, and ask before opening a package
from a link's `?src=`.

**Kept by the host.** `resume="host"` stores nothing on the device. The element fires `userdata`
on every save; keep the latest `data` per `dataType` and `subContentId` under your own user and
package, and before the next load of that package set `userData` to
`[{ dataType, subContentId, data }]`.

**Starting over.** With `resume` on the device, `clearUserData()` forgets what is held for the
package loaded now; to restart it, remove `src` and set it again (or set `file` again).
