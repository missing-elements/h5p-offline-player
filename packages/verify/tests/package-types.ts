/**
 * The package as a TypeScript caller sees it: imported by its name, through the `types` condition
 * of its `exports`, from the declarations `pnpm types` generates from the JSDoc. Type-checked by
 * `pnpm typecheck`; nothing here runs.
 */
import { VerifyError, summarize, verifyPackage, type VerifyReport } from '@missing-elements/h5p-verify'
// @ts-expect-error a helper the tests use, not part of the package's API (#60)
import { contentChanges } from '@missing-elements/h5p-verify'

export async function asACallerWould(): Promise<string> {
  const report: VerifyReport = await verifyPackage({ file: 'course.h5p', untrusted: true, out: 'report/' })
  const passed: boolean = report.verdict === 'pass'
  const missing: string[] | undefined = report.errors.find((error) => error.missingLibraries)?.missingLibraries?.folders
  const changed: string[] = (report.contentCheck?.changes ?? []).map(({ path, change }) => `${path}: ${change}`)
  const refreshed: string[] = report.refreshed.map(({ library, from, to }) => `${library} ${from} → ${to}`)

  // @ts-expect-error an option the verifier does not take
  await verifyPackage({ file: 'course.h5p', timeout: 1_000 })

  void [passed, missing, changed, refreshed, contentChanges, new VerifyError('could not run') instanceof Error]
  return summarize(report)
}
