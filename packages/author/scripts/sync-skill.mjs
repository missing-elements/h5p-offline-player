// Writes the generated section of each of the h5p-author skill's type files, `references/types/<machine
// name>.md`, from the pack this package pins: the content type's fields as `h5p-author schema --markdown`
// prints them. Run after the pack changes (`pnpm --filter @missing-elements/h5p-author sync:skill`); the
// weekly refresh does, and apps/skills' test fails when a file is out of date.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { GENERATED_END, GENERATED_START, schemaOf } from '../lib/author.mjs'

const folder = resolve(import.meta.dirname, '../../../skills/h5p-author/references/types')
const check = process.argv.includes('--check')
let stale = 0
for (const name of (await readdir(folder)).filter((file) => file.endsWith('.md')).sort()) {
  const path = join(folder, name)
  const text = await readFile(path, 'utf8')
  const section = await schemaOf(name.slice(0, -'.md'.length), { markdown: true })
  const start = text.indexOf(GENERATED_START)
  const end = text.indexOf(GENERATED_END)
  const updated = start >= 0 && end > start
    ? `${text.slice(0, start)}${section}${text.slice(end + GENERATED_END.length)}`
    : `${text.trimEnd()}\n\n${section}\n`
  if (updated === text) continue
  stale += 1
  if (check) console.error(`${name} is out of date with the pack`)
  else await writeFile(path, updated)
}
if (check && stale) process.exitCode = 1
console.log(check ? `${stale} type file${stale === 1 ? '' : 's'} out of date` : `${stale} type file${stale === 1 ? '' : 's'} written`)
