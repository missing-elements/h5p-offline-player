# Coming from h5p-standalone

The element takes h5p-standalone's options by the same names where they still apply. It ran
h5p-standalone inside its frame until the runtime vendored the H5P core from h5p-php-library and
loaded it itself; the libraries load in the same order, and the options mean what they meant.

| h5p-standalone | Here | Note |
|---|---|---|
| `h5pJsonPath` | `src` or `file` | The package, not a folder |
| `frameJs`, `frameCss` | `runtime` or `assets-base` | |
| `frame`, `copyright`, `export`, `icon`, `embed` | the same, as bare attributes | `frame` shows the action bar the buttons live in |
| `fullScreen` | `fullscreen="off"` to turn off | On by default here |
| `downloadUrl` | `download-url` | Defaults to the package URL |
| `embedCode`, `resizeCode` | `embed-code`, `resize-code` | Same `:w` and `:h` placeholders |
| `customCss`, `customJs` | `custom-css`, `custom-js` | Space separated; their origins are allowed by the frame's CSP |
| `reportingIsEnabled` | `reporting` | |
| `xAPIObjectIRI` | `activity-id` | Defaults to the package URL |
| `translations` | `lang` | H5P's own strings in that language, from the runtime's translations; inherited from the page. Strings of your own cannot be passed |
| `user` | the `user` property | `{ name, mail }`; never stored |
| `metadata`, `title` | — | Read from the package's `h5p.json` |
| `contentUserData`, `saveFreq` | `resume`, `userData`, `save-interval` | |
| `ajax.setFinishedUrl`, `postUserStatistics` | the `finished` event | Nothing is posted anywhere |
| `ajax.contentUserDataUrl` | `resume="host"` and the `userdata` event | |
| `id`, `librariesPath`, `contentJsonPath`, `embedType`, `preventH5PInit` | — | Decided by the package and the frame |

For formulas, see [Troubleshooting](troubleshooting.md) rather than `customJs`.
