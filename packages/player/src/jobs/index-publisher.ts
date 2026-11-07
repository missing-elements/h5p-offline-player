import type { ForwardIndexSnapshot } from '../shared/forward-index.js'

/**
 * What a download from a host that ignores `Range` publishes as it goes: the entries its local
 * headers have given up so far, stored beside the watermark for the Service Worker to serve from,
 * and the progress reports, each sent once what it reports is stored.
 *
 * The order is the point (#144). On each report the element asks the Service Worker whether the
 * frame can boot yet (`downloadAndIndex`), and the worker answers from the stored snapshot. A
 * report sent before its snapshot was stored was answered from the one before, and nothing asked
 * again until the next report, a chunk later. For a package under two chunks, the first report is
 * the last before the end, so the frame waited for the whole download.
 */
export class IndexPublisher {
  private published = -1
  private chain: Promise<void> = Promise.resolve()
  private refused = false

  constructor(
    private readonly scanner: { snapshot(): ForwardIndexSnapshot; finish(): void },
    private readonly write: (snapshot: ForwardIndexSnapshot) => Promise<void>
  ) {}

  /**
   * Stores what the scanner has found, when it has found more than was stored; with `final`, its
   * last word, whatever it holds. Serialised: two snapshots racing to the same record could land
   * the older one last. A snapshot the store refuses is dropped and the chain goes on from the
   * next one: the index is what lets the frame boot before the download is whole, and the central
   * directory is the authority once it is, so a refused write costs an early boot and never the
   * download. Caught on each link, because a rejected link would skip every later one and come
   * back as an unhandled rejection on each `void` call, and fail the download at the final publish.
   */
  publish(final: boolean): Promise<void> {
    if (final) this.scanner.finish()
    const snapshot = this.scanner.snapshot()
    if (!final && snapshot.entries.length === this.published) return this.chain
    this.published = snapshot.entries.length
    this.chain = this.chain
      .then(() => this.write(snapshot))
      .catch((error: unknown) => {
        if (this.refused) return
        this.refused = true
        console.warn('[h5p-player] the forward index could not be written; the frame boots once the download is whole:', error)
      })
    return this.chain
  }

  /**
   * Sends a progress report once the snapshot of what has arrived is stored, or refused. With
   * nothing new to store, it waits only for the writes already under way, so reports go out in
   * the order they were made, and the last of them before the final publish.
   */
  report(send: () => void): void {
    void this.publish(false).then(send)
  }
}
