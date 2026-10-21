/**
 * The package as a TypeScript caller sees it: imported by its name, through the `types` condition
 * of its `exports`, from the declarations `pnpm types` generates from the JSDoc. Type-checked by
 * `pnpm typecheck`; nothing here runs.
 */
import { EmbedError, buildSite, type BuiltSite } from '@missing-elements/h5p-embed'
import { startEmbed } from '@missing-elements/h5p-embed/embed.js'
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

  void [hosts, parseOrigin, new EmbedError('refused') instanceof Error]
  return site.csp
}
