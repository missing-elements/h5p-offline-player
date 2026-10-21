/**
 * The package as a TypeScript caller sees it under `node16` and `nodenext` resolution: imported by
 * its name, through the `types` condition of its `exports`, from the declarations `tsc -b` writes
 * into `types/`. Type-checked by `pnpm typecheck` with `tsconfig.consumer.json`; nothing here runs.
 * Those modes follow a relative import only when it names its file, so a source import written
 * without `.js` leaves what comes through it `any` for such a caller (#60), and an expected error
 * below then goes missing.
 */
import { H5PPlayerElement, type PackageMetadata, type PlayerErrorDetail, type ReadyDetail } from '@missing-elements/h5p-offline-player'
import { mountH5P } from '@missing-elements/h5p-offline-player/sw'

export function asACallerWould(worker: ServiceWorkerGlobalScope): string[] {
  const player: H5PPlayerElement | null = document.querySelector('h5p-player')
  mountH5P(worker, { scope: '/h5p/' })

  // @ts-expect-error not an error code
  const code: PlayerErrorDetail['code'] = 'offline'
  // @ts-expect-error the folders are a list
  const folders: NonNullable<PlayerErrorDetail['missingLibraries']>['folders'] = 'H5P.Column-1.18'
  // @ts-expect-error not a kind of source
  const source: NonNullable<ReadyDetail['source']>['type'] = 'ftp'
  // @ts-expect-error the title is a string
  const title: PackageMetadata['title'] = 1

  void [player, code, folders, source, title]
  return player?.libraryBundle?.refreshed?.map(({ library, to }) => `${library} ${to}`) ?? []
}
