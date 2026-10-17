# Packages you did not make

An H5P package is code as well as content: its library folders hold the JavaScript that draws it.
Played as it is, that code runs on your site's origin, where it can read your page's storage and
cookies. `untrusted` plays a package as data instead, which is how the H5P plugins for Moodle,
WordPress and Drupal treat an author's upload:

```html
<h5p-player src="https://elsewhere.example/course.h5p" untrusted></h5p-player>
```

## The two modes, and the H5P plugins

| | Played as it is | `untrusted` | An H5P plugin: Moodle, WordPress, Drupal |
|---|---|---|---|
| The package's own scripts | Run, as your site | Never served | Installed from an upload only for a user who may update libraries |
| Where the libraries come from | The package, then `libraries` for what it lacks | `libraries` only: the pack, or a bundle you name | The libraries installed on the site |
| Files in `content/` | All of them | H5P's list of content file types | H5P's list of content file types |
| The content's fields | As written | Checked against each library's `semantics.json` | Checked the same way, on upload |
| Scripts the frame allows | Your origin, and the hosts the runtime needs | Exact paths only | Whatever the site's own policy allows |
| Media the content names by URL | Loads from that host | Loads from that host | Loads from that host |
| A package carrying a newer library than the site has | Plays with its own copy | Refused, with `missingLibraries.carried` set, so you can offer to play it as it is | Refused, unless the uploader may update libraries |

Played as it is suits packages your own team made. `untrusted` is for everything else: uploads,
links from users, a marketplace, exports from another site.

## What is withheld

- **The package's own library folders.** The libraries come from `libraries` (`pack` unless you
  name another source), which is code you chose. See [Packages without libraries](libraries.md).
- **Every file in `content/` that is not one of H5P's own content types.** Images, audio, video,
  fonts, office documents, subtitles and JSON are served. Scripts, stylesheets, HTML, SVG and XML
  are not.
- **Running any file as a script.** Every file is served with `X-Content-Type-Options: nosniff`,
  whatever its name.
- **Your whole origin in the script policy.** The frame's policy names exact script paths instead;
  [The frame's CSP](frame-csp.md) lists them.

## The content check

Before the runtime reads the content, it checks every field against the `semantics.json` of the
library the field belongs to. This is a port of `H5PContentValidator`, the check the H5P plugins
run before they show content:

- text keeps only the tags its field allows, with their attributes written anew;
- plain text is escaped;
- numbers are held to their range, and choices to their options;
- sub-content must be a library its field names;
- anything the semantics do not name is removed.

The check matters even with every library folder withheld. Markup needs no script to do harm: a
form asking for a password, a frame, a style laid over the page, a tracking image. And content
types put field values into class names and selectors without escaping them, so a field's type
matters too.

Content whose main library has no `semantics.json` does not play. The pack carries every
library's semantics; a bundle of your own has to carry them too.

The port was run side by side with the PHP original on 98 cases:
- 78 XSS vectors, through a formatted field and a plain one;
- every field type;
- the content of real packages.

96 came out identical. The other two are edge cases where the port keeps a cleaner shape: a
multi-select with an invalid option removed, and a number clamped to a maximum the semantics
write as a string. Real content came through unchanged, apart from empty lists and one unknown translation key, which the PHP original
removes too.

The check fails closed. The Service Worker hands an untrusted package's content only to a runtime
that runs the check, 0.2 or later. An older runtime plays nothing.

## When a package is refused

A package that needs a library your sources do not have is refused with `bad-archive`, naming the
missing libraries. Usually it is a library newer than the pack, which a later pack release will
carry.

If the package carries that library itself, `missingLibraries.carried` is `true`. Playing it
without `untrusted` would run the package's own copy. That is a decision for your site, so ask
the visitor, naming the package's host:

```js
player.addEventListener('error', (e) => {
  const missing = e.detail.missingLibraries
  if (missing?.carried && player.untrusted && userAgreesToRunCodeFrom(new URL(player.src, location.href).host)) {
    const src = player.src
    player.untrusted = false
    player.removeAttribute('src')
    player.src = src
  }
})
```

## Checks every package gets

With or without `untrusted`:

- **Entry names.** An entry whose name is not a plain relative path, such as `../index.html`, is
  rejected, and the rest of the package still plays.
- **Libraries.** A package must carry, or get from `libraries`, every library it declares and every
  library those depend on. Otherwise it is refused with the missing ones named, before the
  content starts.

## What it does not cover

- **The libraries are your code.** The pack, or a bundle you name, runs as your site.
- **Firefox.** The exact script paths narrow less there. Firefox checks a script the Service Worker
  builds against the worker's own URL, so the worker's URL has to be in the policy, and with it
  every answer the worker gives. The package's folders are still withheld, and `nosniff` still
  holds.
- **Media the content names.** A field that takes a URL, such as a video on YouTube or an image on
  another host, loads from that host in the learner's browser, in either mode: the frame's policy
  allows images, media and frames from anywhere, as content types need. Content cannot fetch data
  from anywhere but your origin; `connect-src` holds it there.
- **Your origin.** `untrusted` keeps a package's code off your origin, but its content still plays
  there. For a site with signed-in users, [Embed](https://github.com/missing-elements/h5p-offline-player#embed)
  puts the player on a separate domain as well.
- **Correctness.** The check is about safety. Whether a package works at all is what
  [`h5p-verify`](verify.md) answers; `h5p-verify --untrusted` plays it the way your site will, and
  lists what the check removes from it.
