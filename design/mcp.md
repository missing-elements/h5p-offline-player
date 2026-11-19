# The MCP server

`packages/mcp` is `@missing-elements/h5p-mcp`, shown as **H5P Author MCP by Missing Elements**: a
local MCP server over standard input and output that builds a package onto the person's disk,
checks it, and opens it in their browser, or reads one back to change it. It is for apps with no
shell, Claude Desktop first; in an app with a shell, the skill and `npx` build already. A remote
server, for ChatGPT or Claude on the web, is #210 and not this.

- **It holds no rules of its own.** The build, the read, their checks, the outline and the
  confinement to folders (`buildPackage`, `readPackage`, `within`, `publicFetch`, `inside`) are
  h5p-author's; the check, the preview and opening the browser (`verifyPackage`, `summarize`,
  `previewPackage`, `openBrowser`) are h5p-verify's. A rule a tool needs goes into those packages
  first, exported, so the author package and the verifier are published before a server that uses
  something new of theirs.
- **Four tools, and the skill's flow as the instructions.** `h5p_types` lists the pack's content
  types, those with a type file marked, and the skill's brief; given a type, read as a build reads
  one (`sourceType`, so "true false" works), it answers with the type's file, or with `schemaOf` for
  a type with none. `h5p_build` builds a source, `h5p_preview` opens a package, and `h5p_read`
  reads one back into its source. The instructions are the flow in a few lines: the type is the one
  question, its answer is read before the source is written, then the build, where the file is and
  what the check found, and the preview offered; a package the person has is read, its source
  changed, and built. Not `SKILL.md`, whose build routes do not apply here. An app sends the descriptions and the
  instructions with every message, so they stay under about 1,500 tokens; `server.test.ts` holds
  them under 6,000 characters.
- **`h5p_build` shows a source's own fields; the build checks them.** Its `source` carries the
  fields of the author package's `sourceSchema` as JSON Schema properties (#230), so a model writes
  the authors and the licence right before its first build: without them, Haiku wrote
  `"authors": ["Unknown"]` in 2 of 3 runs that built, and with them in none of 9. Nothing is said
  to be required or forbidden, and the field takes any object, since the build reads a source
  written another way as it is meant and says every problem at once (#174), where the SDK, or an
  app that holds a call to the schema, would refuse it unread.
- **The folders: `--allow`, else the app's roots, else Desktop, Documents and Downloads.** A folder
  the person named when adding the server is their choice and comes first; the app's roots come
  next, asked on every call, since they change; both are taken as given. The defaults are never
  the home folder whole: one that is a link to the home folder, or to a folder holding it, is left
  out. A build reads local files and writes its package only there (`within`), and refuses to
  download from an address on a local network (`publicFetch`, a guard against a model's mistake or
  a planted address, not a hostile network); the preview opens only a package there (`inside`). A
  hosted video's address is no download: it is kept, and the player loads it wherever it points,
  since Panopto is often an institution's own server on its own network.
- **A build never writes over a file.** With no `output`, the package is named from its title
  (`fileStem`: the title's letters and digits, in any script, cut at 60 characters, and `-file`
  after a name Windows keeps for a device, as `con`). A name that is taken, the package's or its
  source's, by a file or by a link even to nowhere, gets the next number, and so does a taken
  `output`, as the build itself refuses to write over a file. A name is held while its build runs,
  so builds at once take names of their own. The answer names the path written. Beside the package
  goes its source, `<name>.source.json`, which the build page opens to change and build again; it
  is made new, never written over or through a link, and where it cannot be, the answer says so.
- **A build answers with the content, the check and a picture.** The build's line, the H5P core a
  site needs (`coreApiLine`), its notes, the
  outline (80 lines at most) and, with `verify`, the default, the verifier's summary of a check run
  in a temporary folder, with its screenshot as an image. Where neither Chrome, Edge nor
  Playwright's Chromium is found, the answer says "Not verified" and why. A source with problems
  is refused, every problem by its path, and nothing is written.
- **A read writes beside the package, and names its files where it wrote them** (#236).
  `h5p_read` takes a package in the folders, a name alone being the first folder's, and writes its
  source and media into a new folder beside it, named after it and numbered where the name is
  taken, as a package is. It answers with the source, each file named by its full path in that
  folder, so `h5p_build` reads them wherever its package goes, and looks for one the package lacks
  there and nowhere else. Asked to add two harder questions to the
  demo's quiz, Haiku read it and built at the first build in 6 of 6 runs. With the package
  described as a path in the server's folders, it first guessed one from its working folder in 3
  of 3; described "by its file name alone", in none of 3.
- **The SDK is v2, and the package ships its source.** `@modelcontextprotocol/server` brings only
  its core and zod, none of the HTTP frameworks v1 installed, so `bin/` and `lib/` are published as
  written, with no bundle. `McpServer` on `StdioServerTransport` serves the 2025 protocol, which
  every app speaks; protocol 2026-07-28 deprecates roots, so serving it would leave the folders to
  `--allow` and the defaults. Standard output is the protocol's, so the command sends `console.log`
  to standard error, and loads the server only after `--help` and `--version` have had their turn.
- **Tested as an app runs it.** `tests/server.test.ts` starts the command over standard input and
  output with the SDK's own client, given one folder, and calls each tool: the list, a type by a
  loose name and one with no file, a build checked in Chromium, a taken name and a link at one,
  two builds at once, a source with a problem, an output outside the folder, a preview served and
  one refused. Each test builds what it needs, so each runs alone. The test script first copies
  the skill's type files into the author package, as the author's `prepack` does.

Not built yet: the MCP registry's `server.json` and Claude Desktop's one-click bundle.
