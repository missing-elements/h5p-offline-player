# After a build here

The package is being built here, from the build archive, with npm or from two files. What follows
is the same for all three: the build's problems, the file's name, the verifier, the link and the
hand-over.

## The build's problems and the file's name

A source with a problem writes nothing: the build lists every problem by its path, so fix them
all and run it again under the same name. Once a build has written its file it never writes
over it, so a later build takes a new name (`course-2.h5p`). Copy the one you hand over to the
name the user asked for without writing over a file already there (`cp -n`). If that name is
taken, ask, or where you cannot ask, take a new name and say so. Never delete or overwrite a file
to free a name. Pass the build's notes on to the user: texts left in English, a slide that holds
too much.

## Verify

```bash
npm view @missing-elements/h5p-verify version --fetch-timeout=10000 --fetch-retries=0 && npx @missing-elements/h5p-verify@latest course.h5p
```

Run it as one line. Its first half asks npm for the verifier's version and gives up after ten
seconds, so that an npm that cannot install here, as after a build from the archive or from two
files, is found out at once and not waited for: where it prints no version, the verifier did not
run and cannot, so do not run it by itself or again, and say the package is **unverified**.

It writes `course.verify/report.json` and `course.verify/screenshot.png` beside the package
(`--out <folder>` puts them elsewhere). Read the report's `verdict`, `reasons`, `errors` and
`warnings`: a run that fails may say why only in `reasons`, such as content that never reached
ready or drew nothing. Look at the screenshot too: layout mistakes raise no error. One run is
enough: the build already writes what an H5P site's content check keeps, so `--untrusted` finds
nothing more. Follow the `h5p-verify` skill's loop if it is installed. Fix the source, never by
removing what fails. Without a browser, say the package is **unverified**.

## The link

**A link that carries the source is written by a command**, with Node or Python, which need no
network: give the one it prints with the package. A source that names files gets none: a link
carries its text, not the files:

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

## Hand over

Let the user play it in their browser:

```bash
npx @missing-elements/h5p-verify@latest course.h5p --preview
```

Run it in the background; it ends once its tab has closed. Ask the user to work through all of
it, wrong answers included; its Download button saves a copy. Where the command does not run on
the user's computer, hand over the file, and the command where no link was printed. If you
already have a browser tool, add `--no-open` and play the address it prints with that tool. Do
not write a browser script to do it: the person's own play is the check, and a script of your
own costs more than the build.

Deliver:

- the `.h5p`, and its source as a file beside it, under the package's name with `.source.json`
  (`course.source.json`), copied as the package was; the build page opens it too. Name the files
  it names, if any: a build reads them beside it;
- the link one of the two commands above printed here for this source, handed over whole: the
  build page, where the user plays the package in any browser, changes the source and builds it
  again, and says how it went at the foot of the page. A link is only what one of them printed:
  none for a source that names files, and none where neither runs. Give no other web address;
- `screenshot.png` from the run that passed; where it could not run, call the package
  **unverified**; where it ran but failed, give its reasons and say the package **failed
  verification**;
- the build's notes, and the preview command where there is no link;
- what a pass means: it starts and draws, not that it is accurate, accessible or right for
  every LMS;
- that it carries the editor libraries an H5P site's upload check asks for, so a Moodle with no
  library installed accepts it (the one site tried);
- that it carries H5P's libraries, each under its own licence, most MIT, so the user checks
  those terms before they distribute it.
