# The MCP server

`packages/mcp` is `@missing-elements/h5p-mcp`, shown as **H5P Author MCP by Missing Elements**: a
local MCP server over standard input and output that builds a package onto the person's disk,
checks it, and opens it in their browser. It is for apps with no shell, Claude Desktop first; in an
app with a shell, the skill and `npx` build already. A remote server, for ChatGPT or Claude on the
web, is #210 and not this.

- **It holds no rules of its own.** The build, its checks, the outline and the confinement to
  folders (`buildPackage`, `within`, `publicFetch`, `inside`) are h5p-author's; the check, the
  preview and opening the browser (`verifyPackage`, `summarize`, `previewPackage`, `openBrowser`)
  are h5p-verify's. A rule a tool needs goes into those packages first, exported, so the author
  package and the verifier are published before a server that uses something new of theirs.
- **Three tools, and the skill's flow as the instructions.** `h5p_types` lists the pack's content
  types, those with a type file marked, and the skill's brief; given a type, read as a build reads
  one (`sourceType`, so "true false" works), it answers with the type's file, or with `schemaOf` for
  a type with none. `h5p_build` builds a source and `h5p_preview` opens a package. The instructions
  are the flow in a few lines: the type is the one question, its answer is read before the source is
  written, then the build, where the file is and what the check found, and the preview offered.
  Not `SKILL.md`, whose build routes do not apply here. An app sends the descriptions and the
  instructions with every message, so they stay under about 1,500 tokens; `server.test.ts` holds
  them under 6,000 characters.
- **The folders: `--allow`, else the app's roots, else Desktop, Documents and Downloads.** A folder
  the person named when adding the server is their choice and comes first; the app's roots come
  next, asked on every call, since they change; never the home folder whole. A build reads local
  files and writes its package only there (`within`) and fetches from the public internet only
  (`publicFetch`); the preview opens only a package there (`inside`).
- **A build never writes over a file.** With no `output`, the package is named from its title
  (`fileStem`: the title's letters and digits, in any script), with the next number where the name
  is taken; a taken `output` gets the next number too, as the build itself refuses to write over a
  file. The answer names the path written. Beside the package goes its source, `<name>.source.json`,
  which the build page opens to change and build again.
- **A build answers with the content, the check and a picture.** The build's line, its notes, the
  outline (80 lines at most) and, with `verify`, the default, the verifier's summary of a check run
  in a temporary folder, with its screenshot as an image. Where no Chromium-based browser is found,
  the answer says "Not verified" and why. A source with problems is refused, every problem by its
  path, and nothing is written.
- **The SDK is bundled.** `scripts/build.mjs` bundles the command with `@modelcontextprotocol/sdk`
  and zod into `dist/h5p-mcp.mjs` with esbuild, the author package and the verifier left as
  dependencies. `npx` then installs neither Express nor Hono nor the SDK's other HTTP dependencies,
  which a server over standard input never loads. `dist/NOTICE.txt` lists what is bundled, with the
  licences. Standard output is the protocol's, so the command sends `console.log` to standard error,
  and loads the server only after `--help` and `--version` have had their turn.
- **Tested as an app runs it.** `tests/server.test.ts` starts the bundle over standard input and
  output with the SDK's own client, given one folder, and calls each tool: the list, a type by a
  loose name and one with no file, a build checked in Chromium, a taken name, a source with a
  problem, an output outside the folder, a preview served and one refused. The test script first
  copies the skill's type files into the author package, as the author's `prepack` does.

Not built yet: reading a package back to a source (step 3 of #219), checking a video's bytes
(#218), the MCP registry's `server.json` and Claude Desktop's one-click bundle.
