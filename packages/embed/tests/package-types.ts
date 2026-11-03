/**
 * The package as a TypeScript caller sees it: imported by its name, through the `types` condition
 * of its `exports`, from the declarations `pnpm types` generates from the JSDoc. Type-checked by
 * `pnpm typecheck`; nothing here runs.
 */
import { EmbedError, buildSite, type BuiltSite } from '@missing-elements/h5p-embed'
import { startEmbed } from '@missing-elements/h5p-embed/embed.js'
import { buildScorm, type BuiltScorm } from '@missing-elements/h5p-embed/scorm'
import { buildScormInPage, type PageScorm } from '@missing-elements/h5p-embed/scorm/browser'
import { startScormPage } from '@missing-elements/h5p-embed/scorm-page.js'
import { pack } from '@missing-elements/h5p-libraries'
import { runtime } from '@missing-elements/h5p-runtime'
// @ts-expect-error a helper the tests use, not part of the package's API (#60)
import { parseOrigin } from '@missing-elements/h5p-embed'

export async function asACallerWould(): Promise<string> {
  const site: BuiltSite = await buildSite({ out: 'public/player', packages: ['https://cdn.example.org'], defaultLibraries: 'pack' })
  const hosts: string[] = site.packages ?? []

  // The page, bundled, with the libraries and the runtime as their packages export them.
  startEmbed({ runtime, pack, defaultLibraries: 'pack', askInOwnFrame: false })

  // @ts-expect-error the folder is named `out`
  await buildSite({ folder: 'public/player' })

  // One package as a SCORM zip, for an LMS.
  const zip: BuiltScorm = await buildScorm({ h5p: 'course.h5p', out: 'course.scorm.zip', force: true })
  const build: string = zip.build
  const fromPack: string[] = zip.libraries
  // @ts-expect-error the package is named `h5p`
  await buildScorm({ package: 'course.h5p', out: 'course.scorm.zip' })

  // The same zip built in a page, from a picked file, with the pack as its package exports it.
  const inPage: PageScorm = await buildScormInPage({ file: new Blob([]), name: 'course.h5p', base: 'https://player.example/', pack, version: '1.4.0', onProgress: ({ step }) => step })
  const blob: Blob = inPage.blob
  startScormPage({ pack, version: '1.4.0', packVersion: '1.0.1' })
  // @ts-expect-error the package is a `file`, not a path
  await buildScormInPage({ h5p: 'course.h5p' })

  void [hosts, build, fromPack, blob, parseOrigin, new EmbedError('refused') instanceof Error]
  return site.csp
}
