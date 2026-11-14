# Route 4: in the user's browser

No package is built here. [The build page](https://missing-elements.github.io/h5p/build/) builds
it in the user's browser from the source alone, with no install. The user plays it there, which is
its only check, and downloads it from there: it is **unverified** until they have.

**Hand the source over as one link that you write yourself, with the source in it as JSON.** Write
no code block and run no command for it: the link is the whole hand-over, and your reply holds the
source once, inside it.

```markdown
[Build and play it](https://missing-elements.github.io/h5p/build/#source=SOURCE)
```

In place of `SOURCE`, write the whole source as JSON on one line. Write every character as it is,
letters of any language too, except these eight, which a link cannot hold as they are:

| Character | Write |
| --- | --- |
| a space | `%20` |
| `%` | `%25` |
| `&` | `%26` |
| `\` | `%5C` |
| `(` and `)` | `%28` and `%29` |
| `<` and `>` | `%3C` and `%3E` |

So `"question": "<p>Is it (really) 100%?</p>"` is written
`"question":"%3Cp%3EIs%20it%20%28really%29%20100%25?%3C/p%3E"`. The link ends with a `)` right
after the source's last `}`.

Your reply holds:

- the link;
- one line asking the user to click it: the page builds the activity, plays it, and saves it as a
  `.h5p`. Where the source names files, add that the page asks for them first: a link carries the
  source's text, not its files;
- only where you have a code tool, this line, as it is, since attached to a message the archive
  builds the `.h5p` here:

  ```text
  To get the .h5p file here instead: download https://missing-elements.github.io/h5p/bundles/h5p-author-build.tar.gz (15 MB) and attach it to your next message.
  ```

Outside a chat, as in a terminal, a link this long may not open on a click: also write the source
to a file named after the activity with `.source.json`, and say that the build page opens it under
*Or open a file*.

The build page lists every problem by its path, with a button that copies them for the chat: fix
them all and give a new link.
