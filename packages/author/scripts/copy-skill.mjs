// The h5p-author skill's text, copied into the package as `prepack` runs: `SKILL.md`, its brief,
// `references/authoring.md`, its build routes, `references/build/`, one file a way to build, and
// its type files, each content type's notes, an example and its fields, as the release has them.
// A page that builds, with no skill beside it, hands the type files to a chat whose source had
// problems (#172), and a site builds the skill's zips from the package it pins. They are the
// skill's, at the repository's root, where `npx skills add` looks; the copy is not in git.
import { cp, readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const skill = new URL('../../../skills/h5p-author/', import.meta.url)
const references = fileURLToPath(new URL('references/', skill))
/** The `.md` files of one folder of the skill's `references/`, which may not be empty. @param {string} folder */
const count = async (folder) => {
  const names = (await readdir(`${references}${folder}/`)).filter((name) => name.endsWith('.md'))
  if (!names.length) throw new Error(`No ${folder} files in ${references}${folder}/`)
  return names.length
}
const [types, build] = [await count('types'), await count('build')]

await rm(fileURLToPath(new URL('../references/', import.meta.url)), { recursive: true, force: true })
await rm(fileURLToPath(new URL('../SKILL.md', import.meta.url)), { force: true })
await cp(references, fileURLToPath(new URL('../references/', import.meta.url)), { recursive: true })
await cp(fileURLToPath(new URL('SKILL.md', skill)), fileURLToPath(new URL('../SKILL.md', import.meta.url)))
console.log(`Copied SKILL.md, references/authoring.md, ${build} build files to references/build/ and ${types} type files to references/types/`)
