# H5P Author MCP by Missing Elements

`@missing-elements/h5p-mcp` lets an AI app make H5P content on your computer: quizzes, fill in the
blanks, flash cards, presentations, interactive books, branching scenarios and the rest of the
content types the H5P hub serves. It writes a playable `.h5p` that carries its libraries, checks
that it plays in a real H5P player, and opens it in your browser. It reads a `.h5p` you have back
into its source too, to change it and build it again. No H5P site, server or account.

It is a local [MCP](https://modelcontextprotocol.io) server: your app starts it on your computer,
and it sends nothing to a server of ours. It needs Node 22 or newer, and for the check Chrome or
Edge; without either, run `npx playwright install chromium` once.

## Add it to your app

**Claude Desktop**: Settings, Developer, Edit Config, then in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "h5p": { "command": "npx", "args": ["-y", "@missing-elements/h5p-mcp"] }
  }
}
```

**Claude Code**: `claude mcp add h5p -- npx -y @missing-elements/h5p-mcp`

**VS Code**: in `.vscode/mcp.json`:

```json
{ "servers": { "h5p": { "command": "npx", "args": ["-y", "@missing-elements/h5p-mcp"] } } }
```

Then ask, for example: "Make a five-question quiz about the water cycle as an H5P file."

## The folders it uses

It reads the files your content names, and writes packages, only in its folders: those you give
with `--allow`, as in `"args": ["-y", "@missing-elements/h5p-mcp", "--allow", "/Users/me/Lessons"]`
(repeat it for more); else the folders your app gives it; else your Desktop, Documents and
Downloads, and then never your home folder whole. It never writes over a file: a name that is taken
gets a number, and it says which.

## Tools

- `h5p_types`: the content types, and how to write a source for one.
- `h5p_build`: a package from a source, its source beside it as `.source.json`. A source with
  problems is refused, each problem named. It checks the package, says what it holds, and which
  H5P core a site needs to take it.
- `h5p_preview`: opens a package in your browser, in the real player, served from your computer
  until its tab is closed.
- `h5p_read`: a package back into its source, with its pictures and other files, in a new folder
  beside it, to change and build again. It reads content made for the library pack's versions of
  its libraries, and says what a source cannot hold, such as the author's comments.

## What leaves your computer

The build downloads each picture, video, recording or other file your content names by web
address, and refuses to download from an address on your local network: a guard against a mistaken
or planted address, not against a hostile network. A video on YouTube, Vimeo, Panopto or Echo360 is
not downloaded: it stays an address, which the player loads wherever it points, as H5P does
anywhere. Math is drawn by the package's own copy of MathJax, which loads nothing from elsewhere.
The check and the preview play the package from your computer. Your app
sends your conversation to its model, as it does without this server.

## Licence

MIT. The H5P libraries a package carries are under their own licences, listed in it.

H5P is a trademark of H5P Group. This server is made by Missing Elements and is not affiliated with
or endorsed by H5P Group.
