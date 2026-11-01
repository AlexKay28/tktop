/**
 * Store — the stateful hub: polls adapters, derives burn rates,
 * keeps sparkline history, owns view knobs. See docs/ADR-001.
 */
import type { Adapter, GroupKey, SessionInfo, SortKey, TokenCounts } from "./types"
import { totalTokens } from "./format"

/** Session snapshot enriched with derived live metrics. */
export interface SessionRow extends SessionInfo {
  /** output+reasoning tokens per minute, EMA-smoothed */
  burnRate: number
  /** input tokens per minute, EMA-smoothed */
  inRate: number
  /** last N burn-rate samples for the sparkline */
  history: number[]
  /** true while activity within ACTIVE_WINDOW */
  active: boolean
}

const ACTIVE_WINDOW_MS = 5 * 60 * 1000
const HISTORY_LEN = 90
const EMA_ALPHA = 0.4
/** burn rates below this are considered noise */
const RATE_EPSILON = 0.5

interface Sample {
  row: SessionInfo
  time: number
}

export class Store {
  private adapters: Adapter[]
  private byKey = new Map<string, SessionRow>()
  private prev = new Map<string, Sample>()
  private lastTickAt = 0
  private initialized = false

  intervalMs: number
  sortKey: SortKey = "burn"
  groupBy: GroupKey = "none"
  filter = ""
  showArchived = false

  constructor(adapters: Adapter[], intervalMs = 2000) {
    this.adapters = adapters
    this.intervalMs = intervalMs
  }

  get adapterErrors(): string[] {
    return this.adapters
      .map((a) => (a.lastError ? `${a.harness}: ${a.lastError}` : null))
      .filter((s): s is string => s != null)
  }

  get adaptersLive(): { harness: string; sessions: number; error: string | null }[] {
    return this.adapters.map((a) => ({
      harness: a.harness,
      sessions: [...this.byKey.values()].filter((r) => r.harness === a.harness).length,
      error: a.lastError,
    }))
  }

  /** One polling pass over all adapters. Safe to call repeatedly. */
  async tick(): Promise<void> {
    const now = Date.now()
    const dtMin = this.lastTickAt > 0 ? (now - this.lastTickAt) / 60000 : 0
    this.lastTickAt = now

    const seen = new Set<string>()
    const results = await Promise.all(
      this.adapters.map(async (a) => {
        try {
          return a.poll()
        } catch (e) {
          a.lastError = (e as Error).message
          return null
        }
      }),
    )

    for (const sessions of results) {
      if (!sessions) continue
      for (const info of sessions) {
        seen.add(info.key)
        const prevSample = this.prev.get(info.key)
        const dOut =
          info.tokens.output +
          info.tokens.reasoning -
          (prevSample ? prevSample.row.tokens.output + prevSample.row.tokens.reasoning : info.tokens.output + info.tokens.reasoning)
        const dIn = info.tokens.input - (prevSample ? prevSample.row.tokens.input : info.tokens.input)

        let row = this.byKey.get(info.key)
        if (!row) {
          row = { ...info, burnRate: 0, inRate: 0, history: [], active: false }
          this.byKey.set(info.key, row)
        }
        Object.assign(row, info)

        if (this.initialized && dtMin > 0 && prevSample) {
          // counters can be rewritten by adapters; ignore negative deltas
          const rawBurn = Math.max(0, dOut) / dtMin
          const rawIn = Math.max(0, dIn) / dtMin
          row.burnRate = row.burnRate > 0 ? row.burnRate + EMA_ALPHA * (rawBurn - row.burnRate) : rawBurn
          row.inRate = row.inRate > 0 ? row.inRate + EMA_ALPHA * (rawIn - row.inRate) : rawIn
          if (row.burnRate < RATE_EPSILON) row.burnRate = rawBurn < RATE_EPSILON ? 0 : rawBurn
        }
        row.active = now - info.timeUpdated < ACTIVE_WINDOW_MS
        row.history.push(row.burnRate)
        if (row.history.length > HISTORY_LEN) row.history.shift()

        this.prev.set(info.key, { row: structuredClone(info), time: now })
      }
    }

    // drop sessions that disappeared (db cleanup, generic source removal)
    for (const key of [...this.byKey.keys()]) {
      if (!seen.has(key)) {
        this.byKey.delete(key)
        this.prev.delete(key)
      }
    }
    this.initialized = true
  }

  /** Apply filter/sort/group to the current snapshot. */
  rows(): SessionRow[] {
    const f = this.filter.trim().toLowerCase()
    let list = [...this.byKey.values()]
    if (!this.showArchived) list = list.filter((r) => !r.archived)
    if (f) {
      list = list.filter((r) =>
        [r.title, r.model, r.harness, r.directory, r.id].join(" ").toLowerCase().includes(f),
      )
    }

    const cmp: Record<SortKey, (a: SessionRow, b: SessionRow) => number> = {
      burn: (a, b) => b.burnRate - a.burnRate || b.timeUpdated - a.timeUpdated,
      recent: (a, b) => b.timeUpdated - a.timeUpdated,
      tokens: (a, b) => totalTokens(b.tokens) - totalTokens(a.tokens),
      cost: (a, b) => b.cost - a.cost,
    }
    list.sort(cmp[this.sortKey])

    if (this.groupBy === "none") return list

    const groups = new Map<string, SessionRow[]>()
    for (const r of list) {
      const g = this.groupBy === "harness" ? r.harness : r.model
      const arr = groups.get(g)
      if (arr) arr.push(r)
      else groups.set(g, [r])
    }
    // keep group order stable by the order groups appear in the sorted list
    const out: SessionRow[] = []
    const seen = new Set<string>()
    for (const r of list) {
      const g = this.groupBy === "harness" ? r.harness : r.model
      if (seen.has(g)) continue
      seen.add(g)
      out.push(...(groups.get(g) ?? []))
    }
    return out
  }

  /** Group boundary helper for the view: returns group label or null. */
  groupLabel(row: SessionRow, prevRow: SessionRow | null): string | null {
    if (this.groupBy === "none") return null
    const g = this.groupBy === "harness" ? row.harness : row.model
    const pg = prevRow ? (this.groupBy === "harness" ? prevRow.harness : prevRow.model) : null
    return g !== pg ? g : null
  }

  /** Totals over the *filtered* view (mirrors what the user sees). */
  totals(rows: SessionRow[]): {
    sessions: number
    active: number
    tokens: TokenCounts
    cost: number
    burnRate: number
  } {
    const t: TokenCounts = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    let cost = 0
    let active = 0
    let burn = 0
    for (const r of rows) {
      for (const k of Object.keys(t) as (keyof TokenCounts)[]) t[k] += r.tokens[k]
      cost += r.cost
      if (r.active) {
        active++
        burn += r.burnRate
      }
    }
    return { sessions: rows.length, active, tokens: t, cost, burnRate: burn }
  }
}
