import type { ByteRange } from './range.js'

/**
 * Small reads of an archive, kept in fixed blocks so that reading the same bytes again costs no
 * request. pdf.js's loader is the model: it reads a document in ranges aligned to 64 kB chunk
 * boundaries and fetches each chunk once (`ChunkedStreamManager`).
 *
 * zip.js reads an index in small pieces, one after another: 64 kB from the end to find the end of
 * the central directory, then the directory, which in a package of a few hundred entries lies
 * inside those same bytes, then each entry's 30-byte local header and after it the data. Over
 * HTTP each piece was a request, and the reader the Service Worker builds again once libraries are
 * attached read every one of them again: thirteen ranged requests in sequence before a 1.5 MB quiz
 * booted (#133). Through this cache the tail and the directory are one request, a small entry's
 * header and data share one, and a rebuilt reader asks for nothing.
 *
 * Blocks are aligned to multiples of the block size from the start of the archive, and the blocks
 * a read is missing are fetched in one request per contiguous run. A block on its way is shared: a
 * second read that needs it waits for that fetch instead of asking again, and a fetch that fails
 * is forgotten, so the next read asks again. Once more than `maxBytes` are held the least recently
 * used block goes first; a read keeps hold of the blocks it is assembling, so eviction never takes
 * bytes out from under it.
 *
 * Nothing here is authority: the key names the bytes — the archive's URL, validator and size, the
 * ingredients of its package id — and the cache dies with the worker that holds it. The blocks
 * an index was read from are the exception: kept with the package when the archive has a
 * validator (`blocksOf`), and put back by the next worker (`seed`), so a worker the browser
 * stopped does not read the index again (#136).
 */
export class BlockCache {
  /** Held blocks by `blockId`, oldest use first: a use moves a block to the end. */
  private readonly blocks = new Map<string, Uint8Array>()
  /** Blocks on their way, by `blockId`. */
  private readonly pending = new Map<string, Promise<Uint8Array>>()
  private held = 0

  constructor(
    private readonly blockSize: number,
    private readonly maxBytes: number
  ) {}

  /** Whether every block of `range` is held, so that reading it costs nothing. */
  holds(key: string, range: ByteRange): boolean {
    const last = Math.floor(range.end / this.blockSize)
    for (let index = Math.floor(range.start / this.blockSize); index <= last; index += 1) {
      if (!this.blocks.has(blockId(key, index))) return false
    }
    return true
  }

  /**
   * The bytes of `range` in an archive of `size` bytes: from the blocks held, and for the blocks
   * missing from `fetchRange`, which is asked for whole blocks, one request per contiguous run. A
   * range reaching past the end of the archive is cut at the end, as a host cuts it.
   */
  async read(
    key: string,
    size: number,
    range: ByteRange,
    fetchRange: (range: ByteRange) => Promise<Uint8Array>
  ): Promise<Uint8Array> {
    const start = range.start
    const end = Math.min(range.end, size - 1)
    if (end < start) return new Uint8Array(0)

    const first = Math.floor(start / this.blockSize)
    const last = Math.floor(end / this.blockSize)

    // The missing blocks, fetched by run. Nothing awaits between finding them and marking them
    // pending, so two reads that start together never fetch the same block twice.
    let runStart = -1
    for (let index = first; index <= last + 1; index += 1) {
      const id = blockId(key, index)
      if (index <= last && !this.blocks.has(id) && !this.pending.has(id)) {
        if (runStart < 0) runStart = index
        continue
      }
      if (runStart >= 0) {
        this.fetchRun(key, size, runStart, index - 1, fetchRange)
        runStart = -1
      }
    }

    const parts: Array<Uint8Array | Promise<Uint8Array>> = []
    for (let index = first; index <= last; index += 1) {
      const id = blockId(key, index)
      parts.push(this.use(id) ?? this.pending.get(id)!)
    }
    const blocks = await Promise.all(parts)

    const out = new Uint8Array(end - start + 1)
    blocks.forEach((block, i) => {
      const blockStart = (first + i) * this.blockSize
      const from = Math.max(start, blockStart)
      const to = Math.min(end, blockStart + block.length - 1)
      out.set(block.subarray(from - blockStart, to - blockStart + 1), from - start)
    })
    return out
  }

  /**
   * The blocks of `key` held among `indices`, in that order, for keeping beyond this worker
   * (#136): a worker the browser stops takes its cache with it, and the next one read the index
   * again. One not held is left out.
   */
  blocksOf(key: string, indices: Iterable<number>): Array<{ index: number; bytes: Uint8Array }> {
    const out: Array<{ index: number; bytes: Uint8Array }> = []
    for (const index of indices) {
      const bytes = this.blocks.get(blockId(key, index))
      if (bytes) out.push({ index, bytes })
    }
    return out
  }

  /**
   * Holds blocks of `key`, in an archive of `size` bytes, that an earlier worker read: from then
   * on a read finds them as if fetched. A block of the wrong length for its place is left out,
   * and so is one already held or on its way, which is as good or newer.
   */
  seed(key: string, size: number, blocks: Iterable<{ index: number; bytes: Uint8Array }>): void {
    for (const { index, bytes } of blocks) {
      const id = blockId(key, index)
      const expected = Math.min(this.blockSize, size - index * this.blockSize)
      if (!Number.isInteger(index) || index < 0 || expected <= 0 || bytes.length !== expected) continue
      if (this.blocks.has(id) || this.pending.has(id)) continue
      this.keep(id, bytes)
    }
  }

  /** Forgets every block held. Blocks on their way still arrive, and are kept. */
  clear(): void {
    this.blocks.clear()
    this.held = 0
  }

  /** Fetches blocks `firstIndex` to `lastIndex` in one request, each pending until it arrives. */
  private fetchRun(
    key: string,
    size: number,
    firstIndex: number,
    lastIndex: number,
    fetchRange: (range: ByteRange) => Promise<Uint8Array>
  ): void {
    const start = firstIndex * this.blockSize
    const end = Math.min((lastIndex + 1) * this.blockSize, size) - 1
    const fetching = fetchRange({ start, end }).then((bytes) => {
      // A short answer would leave a block that looks whole and is not.
      if (bytes.length !== end - start + 1) {
        throw new Error(`Expected ${end - start + 1} bytes at ${start}, got ${bytes.length}`)
      }
      return bytes
    })

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const id = blockId(key, index)
      const offset = (index - firstIndex) * this.blockSize
      const block = fetching.then((bytes) => {
        // A copy, so that evicting one block frees it rather than the whole run staying held.
        const piece = bytes.slice(offset, Math.min(offset + this.blockSize, bytes.length))
        this.keep(id, piece)
        return piece
      })
      this.pending.set(id, block)
      // Settled either way it is no longer on its way: held if it arrived, asked for again if not.
      const settled = () => {
        if (this.pending.get(id) === block) this.pending.delete(id)
      }
      block.then(settled, settled)
    }
  }

  private use(id: string): Uint8Array | undefined {
    const block = this.blocks.get(id)
    if (!block) return undefined
    this.blocks.delete(id)
    this.blocks.set(id, block)
    return block
  }

  private keep(id: string, block: Uint8Array): void {
    const previous = this.blocks.get(id)
    if (previous) {
      this.held -= previous.length
      this.blocks.delete(id)
    }
    this.blocks.set(id, block)
    this.held += block.length
    while (this.held > this.maxBytes) {
      const [oldest, bytes] = this.blocks.entries().next().value as [string, Uint8Array]
      this.held -= bytes.length
      this.blocks.delete(oldest)
    }
  }
}

function blockId(key: string, index: number): string {
  return `${index}\u0000${key}`
}
