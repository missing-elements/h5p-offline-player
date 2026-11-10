// The h5p-author skill's type files, copied into the package as `prepack` runs: each content
// type's notes, an example and its fields, as the release has them. A page that builds, with no
// skill beside it, hands them to a chat whose source had problems (#172). They are the skill's, at
// the repository's root, where `npx skills add` looks; the copy is not in git.
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const from = fileURLToPath(new URL('../../../skills/h5p-author/references/types/', import.meta.url))
const to = fileURLToPath(new URL('../references/types/', import.meta.url))

await rm(fileURLToPath(new URL('../references/', import.meta.url)), { recursive: true, force: true })
await mkdir(to, { recursive: true })
const files = (await readdir(from)).filter((name) => name.endsWith('.md'))
if (!files.length) throw new Error(`No type files in ${from}`)
for (const name of files) await cp(`${from}${name}`, `${to}${name}`)
console.log(`Copied ${files.length} type files to references/types/`)
