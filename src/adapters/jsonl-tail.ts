/**
 * Shared incremental JSONL reader for adapters.
 *
 * Keeps a byte cursor + partial-line buffer per file so each poll only
 * parses newly appended bytes. Files that shrink (rotation) restart from
 * zero. Individual line parse errors are skipped; the reader never throws
 * to the caller.
 */
import { openSync, readSync, closeSync, statSync } from "node:fs"

interface TailState {
  size: number
  pending: string
}

/** Expand ~ and resolve a glob pattern to concrete file paths. */
export function scanGlob(pattern: string): string[] {
  const pat = pattern.replace(/^~(?=\/)/, (): string => process.env.HOME ?? "")
  const starIdx = pat.indexOf("*")
  const qIdx = pat.indexOf("?")
  const firstWild = starIdx === -1 && qIdx === -1 ? pat.length : Math.min(
    ...(starIdx === -1 ? [pat.length] : [starIdx]),
    ...(qIdx === -1 ? [pat.length] : [qIdx]),
  )
  const splitIdx = pat.slice(0, firstWild).lastIndexOf("/")
  const cwd = splitIdx <= 0 ? "/" : pat.slice(0, splitIdx)
  const sub = splitIdx <= 0 ? pat : pat.slice(splitIdx + 1)
  try {
    const g = new Bun.Glob(sub)
    const rels = [...g.scanSync({ cwd })]
    return rels.map((r) => (cwd === "/" ? "/" + r : cwd + "/" + r))
  } catch {
    return []
  }
}

export class JsonlTail {
  private states = new Map<string, TailState>()
  private files: string[] = []

  constructor(private pattern: string) {}

  /** (Re)discover files matching the pattern. */
  refreshFiles(): void {
    this.files = scanGlob(this.pattern)
  }

  get filePaths(): string[] {
    return this.files
  }

  /**
   * Invoke cb(obj, filePath) for each complete new JSON line in every
   * discovered file. One poll pass.
   */
  read(cb: (obj: any, path: string) => void): number {
    let count = 0
    for (const path of this.files) {
      let size = 0
      try {
        size = statSync(path).size
      } catch {
        this.states.delete(path)
        continue
      }
      let st = this.states.get(path)
      if (!st || size < st.size) st = { size: 0, pending: "" }
      if (size === st.size) continue

      // Read only the new bytes.
      const from = st.size
      const toRead = size - from
      const buf = new Uint8Array(toRead)
      let fd: number | undefined
      let off = 0
      try {
        fd = openSync(path, "r")
        while (off < toRead) {
          const n = readSync(fd, buf, off, toRead - off, from + off)
          if (n <= 0) break
          off += n
        }
      } catch {
        continue
      } finally {
        if (fd !== undefined) closeSync(fd)
      }

      const text = st.pending + new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, off))
      st.size = size
      st.pending = ""
      const lines = text.split("\n")
      st.pending = lines.pop() ?? "" // keep trailing partial line
      for (const line of lines) {
        const s = line.trim()
        if (!s) continue
        try {
          const obj = JSON.parse(s)
          cb(obj, path)
          count++
        } catch {
          // skip malformed line
        }
      }
      this.states.set(path, st)
    }
    return count
  }

  /** Drop bookkeeping for a path (e.g. removed session). */
  clear(path: string): void {
    this.states.delete(path)
  }
}
