/**
 * Generic JSONL adapter — operator-declared sources via
 * ~/.config/tktop/adapters.json. See docs/ADR-003 for the config schema.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import type { Adapter, SessionInfo, TokenCounts } from "../types"
import { JsonlTail } from "./jsonl-tail"

/** Resolve dotted path "a.b.c" against an object; undefined when missing. */
function dig(obj: any, path: string | undefined): any {
  if (!path) return undefined
  let cur = obj
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = cur[seg]
  }
  return cur
}

function toTime(v: any): number {
  if (v == null) return 0
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v
  const t = Date.parse(String(v))
  return Number.isNaN(t) ? 0 : t
}

export interface GenericSourceConfig {
  harness: string
  glob: string
  sessionId?: string
  model?: string
  title?: string
  directory?: string
  timeUpdated?: string
  usage?: string
  tokens?: Partial<Record<keyof TokenCounts, string>>
  cost?: string
  mode?: "additive" | "latest"
}

interface Acc {
  id: string
  model: string
  title: string
  directory: string
  tokens: TokenCounts
  cost: number
  timeUpdated: number
}

export function loadGenericConfig(path?: string): GenericSourceConfig[] {
  const p = path ?? `${homedir()}/.config/tktop/adapters.json`
  if (!existsSync(p)) return []
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"))
    return Array.isArray(raw?.sources) ? (raw.sources as GenericSourceConfig[]) : []
  } catch {
    return []
  }
}

export class GenericJsonlAdapter implements Adapter {
  lastError: string | null = null

  readonly harness: string
  private tail: JsonlTail
  private accs = new Map<string, Acc>()
  private additive: boolean
  private started = false

  constructor(private cfg: GenericSourceConfig) {
    this.harness = cfg.harness || "generic"
    this.tail = new JsonlTail(cfg.glob)
    this.additive = (cfg.mode ?? "additive") === "additive"
  }

  available(): boolean {
    this.tail.refreshFiles()
    return this.tail.filePaths.length > 0
  }

  poll(): SessionInfo[] {
    try {
      if (!this.started) {
        this.tail.refreshFiles()
        this.started = true
      } else {
        this.tail.refreshFiles() // cheap enough for operator-defined source counts
      }
      this.tail.read((obj, path) => this.onLine(obj, path))

      const out: SessionInfo[] = []
      for (const [sid, a] of this.accs) {
        out.push({
          key: `${this.harness}:${sid}`,
          harness: this.harness,
          id: sid,
          title: a.title || sid.slice(0, 12),
          directory: a.directory,
          model: a.model || "-",
          archived: false,
          tokens: { ...a.tokens },
          cost: a.cost,
          timeCreated: a.timeUpdated,
          timeUpdated: a.timeUpdated,
        })
      }
      this.lastError = null
      return out
    } catch (e) {
      this.lastError = (e as Error).message
      return []
    }
  }

  private onLine(obj: any, path: string): void {
    if (!obj || typeof obj !== "object") return
    const sid = String(dig(obj, this.cfg.sessionId) ?? path)
    let acc = this.accs.get(sid)
    if (!acc) {
      acc = {
        id: sid,
        model: "",
        title: "",
        directory: "",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        timeUpdated: 0,
      }
      this.accs.set(sid, acc)
    }

    if (this.cfg.model) {
      const m = dig(obj, this.cfg.model)
      if (m != null) acc.model = String(m)
    }
    if (this.cfg.title && !acc.title) {
      const t = dig(obj, this.cfg.title)
      if (t != null) acc.title = String(t).replace(/\s+/g, " ").slice(0, 80)
    }
    if (this.cfg.directory) {
      const d = dig(obj, this.cfg.directory)
      if (d != null) acc.directory = String(d)
    }
    const ts = toTime(dig(obj, this.cfg.timeUpdated))
    if (ts > acc.timeUpdated) acc.timeUpdated = ts

    const usage = this.cfg.usage ? dig(obj, this.cfg.usage) : obj
    if (usage && typeof usage === "object") {
      const map = this.cfg.tokens ?? {}
      const keys: (keyof TokenCounts)[] = ["input", "output", "reasoning", "cacheRead", "cacheWrite"]
      for (const k of keys) {
        const field = map[k] ?? k
        const v = dig(usage, field as string)
        if (typeof v === "number") {
          if (this.additive) acc.tokens[k] += v
          else acc.tokens[k] = v
        }
      }
    }
    if (this.cfg.cost) {
      const c = dig(obj, this.cfg.cost)
      if (typeof c === "number") {
        if (this.additive) acc.cost += c
        else acc.cost = c
      }
    }
  }
}
