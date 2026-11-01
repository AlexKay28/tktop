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

/** Live scatter track: one moving dot per active session. */
export interface TrackPoint {
  /** x: cumulative input+output tokens */
  x: number
  /** y: burn rate, output tokens per minute */
  y: number
  t: number
}

export interface SessionTrack {
  key: string
  harness: string
  title: string
  model: string
  /** palette index for the dot/trail color */
  color: number
  /** marker glyph index for the scatter head / table dot column */
  marker: number
  points: TrackPoint[]
  /** last tick where the session was active/burning */
  lastActive: number
}

const ACTIVE_WINDOW_MS = 5 * 60 * 1000
const HISTORY_LEN = 90
const EMA_ALPHA = 0.4
/** burn rates below this are considered noise */
const RATE_EPSILON = 0.5
/** how many trail points to keep per session */
const TRACK_POINTS_MAX = 120
/** how long a finished session's dot+trail stays on the scatter */
const TRACK_AFTERGLOW_MS = 15_000
/** scatter palette (catppuccin-ish, distinct hues) */
export const TRACK_COLORS = [
  "#89b4fa",
  "#a6e3a1",
  "#f9e2af",
  "#fab387",
  "#f38ba8",
  "#cba6f7",
  "#94e2d5",
  "#b4befe",
]

function trackColorIndex(key: string): number {
  let h = 7
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return Math.abs(h) % TRACK_COLORS.length
}

/** scatter head markers — single-cell glyphs, one per track */
export const TRACK_MARKERS = ["●", "★", "✖", "◆", "▲", "✚", "■", "✦"]

function trackMarkerIndex(key: string): number {
  // different hash seed so marker/color combinations don't correlate 1:1
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h * 33 + key.charCodeAt(i)) ^ (h >>> 7)) | 0
  return Math.abs(h) % TRACK_MARKERS.length
}

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
  /** sort direction: "desc" is the natural order for value sorts
   *  (hottest/newest/biggest first), "asc" for alphabetical sorts */
  sortDir: "asc" | "desc" = "desc"
  groupBy: GroupKey = "none"
  filter = ""
  showArchived = false
  /** live scatter tracks (see SessionTrack) */
  readonly tracks = new Map<string, SessionTrack>()

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

    results.forEach((sessions, i) => {
      const adapter = this.adapters[i]!
      // ADR-003 rule 1: on adapter failure keep the previous snapshot —
      // treat as "no news": preserve existing rows instead of dropping them.
      const failed = sessions == null || (sessions.length === 0 && adapter.lastError != null)
      if (failed) {
        for (const [key, row] of [...this.byKey.entries()]) {
          if (row.harness === adapter.harness) seen.add(key)
        }
        return
      }
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
    })

    // drop sessions that disappeared (db cleanup, generic source removal)
    for (const key of [...this.byKey.keys()]) {
      if (!seen.has(key)) {
        this.byKey.delete(key)
        this.prev.delete(key)
      }
    }
    this.initialized = true

    // ── live scatter tracks
    for (const row of this.byKey.values()) {
      const burning = row.burnRate > 0
      if (!burning && !row.active) continue
      let track = this.tracks.get(row.key)
      if (!track) {
        track = {
          key: row.key,
          harness: row.harness,
          title: row.title,
          model: row.model,
          color: trackColorIndex(row.key),
          marker: trackMarkerIndex(row.key),
          points: [],
          lastActive: now,
        }
        this.tracks.set(row.key, track)
      }
      track.title = row.title
      track.model = row.model
      track.lastActive = now
      track.points.push({
        x: row.tokens.input + row.tokens.output,
        y: row.burnRate,
        t: now,
      })
      if (track.points.length > TRACK_POINTS_MAX) track.points.shift()
    }
    // afterglow: keep finished dots 15s, then remove
    for (const [key, track] of [...this.tracks.entries()]) {
      if (now - track.lastActive > TRACK_AFTERGLOW_MS) this.tracks.delete(key)
    }
  }

  /** Tracks that currently have a visible dot (active or in afterglow). */
  visibleTracks(): SessionTrack[] {
    const now = Date.now()
    return [...this.tracks.values()].filter((t) => now - t.lastActive <= TRACK_AFTERGLOW_MS)
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
      in: (a, b) => b.tokens.input - a.tokens.input,
      out: (a, b) => b.tokens.output - a.tokens.output,
      cacheR: (a, b) => b.tokens.cacheRead - a.tokens.cacheRead,
      rsn: (a, b) => b.tokens.reasoning - a.tokens.reasoning,
      age: (a, b) => a.timeUpdated - b.timeUpdated,
      harness: (a, b) => b.harness.localeCompare(a.harness) || b.title.localeCompare(a.title),
      model: (a, b) => b.model.localeCompare(a.model) || b.title.localeCompare(a.title),
      title: (a, b) => b.title.localeCompare(a.title),
      dir: (a, b) => b.directory.localeCompare(a.directory) || b.title.localeCompare(a.title),
    }
    // every comparator above is descending-native (hottest / newest / Z→A first);
    // "asc" flips it. Text columns default to "asc" via setSort().
    const base = cmp[this.sortKey]
    list.sort(this.sortDir === "asc" ? (a, b) => base(b, a) : base)

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

  /**
   * Select a sort column (header click / future keys). Clicking the active
   * column toggles the direction. Text columns start ascending (A→Z),
   * value columns start descending (hottest/biggest first).
   */
  setSort(key: SortKey): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === "desc" ? "asc" : "desc"
      return
    }
    this.sortKey = key
    this.sortDir = ["harness", "model", "title", "dir"].includes(key) ? "asc" : "desc"
  }

  /** Group boundary helper for the view: returns group label or null. */  groupLabel(row: SessionRow, prevRow: SessionRow | null): string | null {
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
