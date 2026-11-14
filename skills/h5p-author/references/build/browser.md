# Route 4: in the user's browser

No package is built here. [The build page](https://missing-elements.github.io/h5p/build/) builds
it in the user's browser from the source alone, with no install. The user plays it there, which is
its only check, and downloads it from there: it is **unverified** until they have.

**Hand the source over in a page that makes the link**, whether or not a command runs here (a
chat's code tool can be unavailable for hours), and whether or not you can tell how the chat
shows it. Copy the page below with the whole source in place of the line `SOURCE`, and every
other line as it is: change nothing in its script. The user's browser makes the link from the
source, so nothing compressed is typed or copied; a link copied into a reply from a command's
output can arrive damaged, so run no command for one.

- **In a chat**, write the page in one `html` code block, and give the source nowhere else in that
  reply. Tell the user, in a line or two and in this order: first, to open the block as a page
  with the chat's Preview and click *Build and play it*, which the chat may ask them to allow; only
  then, as the way where their chat shows no Preview, to save the block as a file ending in `.html`
  and open it.
- **Outside a chat**, as in a terminal, write the page to a file ending in `.html` beside the
  source, and tell the user to open it.

```html
<!doctype html>
<meta charset="utf-8">
<title>Build and play</title>
<p><a id="link" target="_blank" rel="noopener">Making the link…</a></p>
<noscript id="source">
SOURCE
</noscript>
<script>
const source = document.getElementById('source').textContent.trim()
const link = document.getElementById('link')
new Response(new Blob([source]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer().then((buffer) => {
  let text = ''
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte)
  link.href = 'https://missing-elements.github.io/h5p/build/#source=' + btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  link.textContent = 'Build and play it'
}, (error) => { link.textContent = 'No link could be made here (' + error + '). Copy the source from the code block into https://missing-elements.github.io/h5p/build/' })
</script>
```

A source that names files gets no page: a page carries its text, not the files. Put the **whole
source in your reply**, in one `json` code block, and tell the user to paste it into the build
page at https://missing-elements.github.io/h5p/build/ and choose its files there. Never give that
address without the source: it builds nothing.

The build page lists every problem by its path, with a button that copies them for the chat: fix
them all and give a new page, or the whole source again.

Where Node runs here and nothing could be installed or downloaded, add this line, as it is, after
the page or the source: attached to a message, the archive builds the `.h5p` here.

```
To get the .h5p file here instead: download https://missing-elements.github.io/h5p/bundles/h5p-author-build.tar.gz (15 MB) and attach it to your next message.
```
