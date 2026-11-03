import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { BlobReader, BlobWriter, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'

/** The demo's quiz, which carries its libraries; and its export without them, with formulas in it. */
export const quiz = resolve(import.meta.dirname, '../../../../apps/demo/demo/content/quiz.h5p')
export const formulas = resolve(import.meta.dirname, '../../../../apps/demo/demo/content/formulas.h5p')

/** A zip's entries, by name, with a way to read each as text or bytes. */
export async function entriesOf(path: string) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(path)])))
  const entries = await reader.getEntries()
  const entry = (name: string) => {
    const found = entries.find((candidate) => candidate.filename === name)
    if (!found || found.directory) throw new Error(`${name} is not in ${path}`)
    return found
  }
  const text = async (name: string) => entry(name).getData!(new TextWriter())
  const bytes = async (name: string) => entry(name).getData!(new Uint8ArrayWriter())
  return { names: entries.filter((candidate) => !candidate.directory).map((candidate) => candidate.filename), entry, text, bytes, close: () => reader.close() }
}

/** The quiz, changed: its `h5p.json` edited, and the entries `drop` names left out. */
export async function changedQuiz(path: string, edit: (manifest: Record<string, any>) => void, drop: (name: string) => boolean = () => false) {
  const reader = new ZipReader(new BlobReader(new Blob([await readFile(quiz)])))
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const entry of await reader.getEntries()) {
    if (entry.directory || drop(entry.filename)) continue
    let bytes = await entry.getData!(new Uint8ArrayWriter())
    if (entry.filename === 'h5p.json') {
      const manifest = JSON.parse(new TextDecoder().decode(bytes))
      edit(manifest)
      bytes = new TextEncoder().encode(JSON.stringify(manifest))
    }
    await writer.add(entry.filename, new Uint8ArrayReader(bytes))
  }
  await reader.close()
  await writeFile(path, new Uint8Array(await (await writer.close()).arrayBuffer()))
}
