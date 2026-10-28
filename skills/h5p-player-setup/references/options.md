# The element's options

## Sizing

The element follows the content's own height by default. Set `auto-resize="off"` only when the
page sizes it itself, from CSS or from the `resize` event, because the height the element writes
is an inline style and would beat the page's rule. Any CSS goes on the `h5p-player` tag itself;
the inside is shadow DOM.

## Display options

Attributes on the element: `frame` (the action bar), `copyright`, `export`, `icon`, `embed`
(bare = on), `fullscreen="off"`, `download-url`, `embed-code`, `custom-css`, `custom-js`,
`reporting`, `activity-id`; and `user`, the learner H5P names in statements, as a property, never
an attribute. A button stays off when its target is missing: `export` without `download-url`,
`embed` without `embed-code`. `activity-id` defaults to the package's URL.

Language is automatic: H5P's own buttons and dialogs are in the content's language, the one its
`h5p.json` names, so a German package shows them in German on any page. `lang`, which the element
inherits from the page's `<html lang>`, decides only for a package that names none; strings of
the host's own cannot be passed.

Formulas need `H5P.MathDisplay` in the package, or `libraries="pack"`, which carries it; not a
`custom-js` recipe.

A site moving from h5p-standalone finds its options here under the same names; the full mapping,
including the ones the `.h5p` or the events replace:
https://github.com/missing-elements/h5p-offline-player/blob/main/docs/h5p-standalone.md

## Resume, only when asked for

By default a reload starts the content over and nothing is stored. `resume` keeps the content's
own saved state — the slide reached, the answers so far, the position in a video — in the
browser's storage on that device and hands it back on the next load; `resume="host"` keeps
nothing on the device and gives the host page a `userdata` event on every save, to hand back
through `userData` before the next load.

Ask before setting it: on a shared machine the state one person leaves is what the next one
finds, so a site with accounts takes `host`, a kiosk or a classroom device takes neither, and a
learner's own device takes `resume`. Either way nothing is sent anywhere, and xAPI statements are
still not stored. With `resume="host"` and each save sent to a server, `save-interval="30"`
spaces the saves as the H5P plugins do; the default is 10 seconds.

The element's full API and events:
https://github.com/missing-elements/h5p-offline-player/blob/main/docs/api.md
