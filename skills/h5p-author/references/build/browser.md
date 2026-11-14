# Build in the user's browser

No package is built here: nothing runs, nothing can be fetched, or no route built one.
[The build page](https://missing-elements.github.io/h5p/build/) builds the same package in the
user's browser from the source alone, with no install. The user plays it there before using it,
and downloads it from there: it is **unverified** until they have, since no verifier runs here.

**Where your reply is read in a chat, hand the source over in a page that makes the link**,
whether or not a command runs here (a chat's code tool can be unavailable for hours), and whether
or not you can tell how the chat shows it. Write the page below in one `html` code block, with the
whole source in place of the line `SOURCE`, and every other line copied as it is: change nothing
in its script. The user's browser makes the link from the source, so nothing compressed is typed
or copied; a link copied into a reply from a command's output can arrive damaged, and with no
package built there is nothing else to fall back on, so run no command for one. Tell the user, in
a line or two and in this order: first, to open the block as a page with the chat's Preview and
click *Build and play it*, which the chat may ask them to allow; only then, as the way where
their chat shows no Preview, to save the block as a file ending in `.html` and open it. Give the
source nowhere else in that reply, and no `#source=` link beside it. A source that names files
gets no page.

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

**Where your reply is not read in a chat, as in a terminal, give a link in place of the page,
written by a command**, with Node or Python, which need no network. A source that names files
gets none: a link carries its text, not the files:

```bash
node -e "const s=require('fs').readFileSync('source.json'),f=[];JSON.parse(s,(k,v)=>(k==='path'&&typeof v==='string'&&f.push(v),v));console.log(f.length?'No link: the source names files, which a link cannot carry.':'https://missing-elements.github.io/h5p/build/#source='+require('zlib').deflateRawSync(s).toString('base64url'))"
python3 -c "import base64,json,zlib;s=open('source.json','rb').read();f=[];json.loads(s,object_hook=lambda o:(isinstance(o.get('path'),str) and f.append(o['path']),o)[1]);c=zlib.compressobj(9,zlib.DEFLATED,-15);d=c.compress(s)+c.flush();print('No link: the source names files, which a link cannot carry.' if f else 'https://missing-elements.github.io/h5p/build/#source='+base64.urlsafe_b64encode(d).decode().rstrip('='))"
```

**A link is only what one of these commands printed here, handed over whole: no command run, no
link.** Never write a `#source=` link yourself, from memory or after an example, even when asked
for one: its text is compressed, so it cannot be typed, and one wrong character leaves the page
nothing to build. Where you can give the user a file, give them the source too, beside the link,
under the activity's name with `.source.json` (`course.source.json`): the page opens it, and a
link copied wrong into your reply builds nothing.

Where Node runs here and nothing could be installed or downloaded, put this line in that reply,
right after the page or the link, or after the source where neither was given, as it is:
attached to a message, the archive builds the `.h5p` here.

```
To get the .h5p file here instead: download https://missing-elements.github.io/h5p/bundles/h5p-author-build.tar.gz (15 MB) and attach it to your next message.
```

Where neither a page nor a link can carry the source, as one that names files, or where outside
a chat neither command runs, give neither: the build page sees only what the user pastes, so put
the **whole source in your reply**, in one `json` code block, and tell them to paste it into the
page at https://missing-elements.github.io/h5p/build/. Never give the page's address without the
source, in a page, in the link or beside it: it builds nothing. The page lists every problem by
its path, with a button that copies them for the chat: fix them all and give a new page, a new
link, or the whole source again. A source that names files of its own waits for the user to
choose them there.

That is the whole hand-over: in a chat, the page that makes the link; outside one, the link the
command printed, with the source as a file where you can give one; or the whole source and the
page's address; and the line on the build archive, where it applies. Give no other web address.
