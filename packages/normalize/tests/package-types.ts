/**
 * The package as a TypeScript caller sees it: imported by its name, through the `types` condition
 * of its `exports`, from the declarations `pnpm types` generates from the JSDoc. Type-checked by
 * `pnpm typecheck`; nothing here runs.
 */
import { archiveFingerprint, formatBytes, normalizeArchive, type EntryResult, type Report } from '@missing-elements/h5p-normalize'
// @ts-expect-error a helper the tests use, not part of the package's API (#60)
import { orderEntries } from '@missing-elements/h5p-normalize'
// For the packages of this repository that write zips, h5p-author's page build among them.
import { crc32 } from '@missing-elements/h5p-normalize/crc32'
// For h5p-author, which reads a video's index where it builds: in Node, and on a page.
import { mp4Info, type Mp4Info } from '@missing-elements/h5p-normalize/mp4'
// @ts-expect-error the walk the normalizer shares with it, not part of the package's API
import { topLevelAtoms } from '@missing-elements/h5p-normalize/mp4'

export async function asACallerWould(): Promise<string> {
  const seen: EntryResult[] = []
  const report: Report = await normalizeArchive({ input: 'in.h5p', output: 'out.h5p', onEntry: (entry) => seen.push(entry) })
  const moved: string[] = report.entries.filter(({ action }) => action === 'faststart').map(({ name }) => name)
  const saved: string = formatBytes(report.payloadIn - report.payloadOut)
  const revision: string = await archiveFingerprint('out.h5p')

  // @ts-expect-error the source is named `input`
  await normalizeArchive({ file: 'in.h5p' })

  // Library folders to write after everything else, the media included (#148).
  const trailing: Report = await normalizeArchive({ input: 'in.h5p', output: 'out.h5p', last: ['H5PEditor.Wizard-1.2'] })
  // @ts-expect-error a list of folder names, not one name
  await normalizeArchive({ input: 'in.h5p', last: 'H5PEditor.Wizard-1.2' })

  const checked: number = crc32(new Uint8Array(4), crc32(new Uint8Array(4)))
  // @ts-expect-error bytes, not text
  crc32('h5p.json')

  const info: Mp4Info | null = await mp4Info(async (offset, length) => new Uint8Array(length), 100)
  const length: number | undefined = info?.duration
  const codecs: string[] = info?.tracks.filter(({ kind }) => kind === 'video').map(({ codec }) => codec) ?? []
  // @ts-expect-error a read, not the bytes
  await mp4Info(new Uint8Array(100), 100)

  void [moved, saved, orderEntries, checked, trailing, length, codecs, topLevelAtoms]
  return `${report.revision} ${revision}`
}
