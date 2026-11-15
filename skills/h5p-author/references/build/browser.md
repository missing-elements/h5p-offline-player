# Route 4: in the user's browser

No package is built here. [The build page](https://missing-elements.github.io/h5p/build/) builds
it in the user's browser from the source alone, with no install. The user plays it there, which is
its only check, and downloads it from there: it is **unverified** until they have.

Your reply holds:

- the whole source, once, in one `json` code block;
- one line telling the user to copy it, open https://missing-elements.github.io/h5p/build/, choose
  *Paste your chat's JSON*, paste it into the box in place of the sample's, and press *Build*.
  Where the source names files, add that the page asks for them before it builds;
- only where you have a code tool: the source as a file too, named after the activity with
  `.source.json`, which the page opens under *Or open a file*; and this line, as it is, since
  attached to a message the archive builds the `.h5p` here:

  ```text
  To get the .h5p file here instead: download https://missing-elements.github.io/h5p/bundles/h5p-author-build.tar.gz (15 MB) and attach it to your next message.
  ```

Give the page's address as it is, with nothing after it: a link that carries the source breaks
where a chat writes or copies one character of it wrong.

Outside a chat, as in a terminal, write the source to that file in place of the code block, and
tell the user to open it on the build page under *Or open a file*.

The build page lists every problem by its path, with a button that copies them for the chat: fix
them all and give the whole source again.
