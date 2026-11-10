// The h5p-author skill's text, copied into the package as `prepack` runs: `SKILL.md`, its brief,
// `references/authoring.md`, and its type files, each content type's notes, an example and its
// fields, as the release has them. A page that builds, with no skill beside it, hands the type
// files to a chat whose source had problems (#172), and serves the skill to a chat given a link to
// it rather than GitHub's, which limits the requests of addresses many users share (#178). They are
// the skill's, at the repository's root, where `npx skills add` looks; the copy is not in git.
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const skill = new URL('../../../skills/h5p-author/', import.meta.url)
const from = fileURLToPath(new URL('references/types/', skill))
const to = fileURLToPath(new URL('../references/types/', import.meta.url))

await rm(fileURLToPath(new URL('../references/', import.meta.url)), { recursive: true, force: true })
await rm(fileURLToPath(new URL('../SKILL.md', import.meta.url)), { force: true })
await mkdir(to, { recursive: true })
const files = (await readdir(from)).filter((name) => name.endsWith('.md'))
if (!files.length) throw new Error(`No type files in ${from}`)
for (const name of files) await cp(`${from}${name}`, `${to}${name}`)
await cp(fileURLToPath(new URL('references/authoring.md', skill)), fileURLToPath(new URL('../references/authoring.md', import.meta.url)))
await cp(fileURLToPath(new URL('SKILL.md', skill)), fileURLToPath(new URL('../SKILL.md', import.meta.url)))
console.log(`Copied SKILL.md, references/authoring.md and ${files.length} type files to references/types/`)
