/** Token counters for one session. */
export interface TokenCounts {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** A normalized session snapshot produced by an adapter. */
export interface SessionInfo {
  /** Unique key across harnesses: `${harness}:${id}` */
  key: string
  harness: string
  id: string
  title: string
  directory: string
  model: string
  agent?: string
  archived: boolean
  tokens: TokenCounts
  cost: number
  /** epoch ms */
  timeCreated: number
  /** epoch ms, last activity */
  timeUpdated: number
  /** raw parent session id within the same harness (subagents); null for roots */
  parentId?: string | null
}

/** One entry in a per-session drill-down timeline (a message / turn / tool call). */
export interface DrillEntry {
  /** epoch ms */
  time: number
  /** normalized role or event type: user, assistant, system, tool, compaction, … */
  role: string
  /** model used for this turn, if recorded */
  model?: string
  /** short human summary (prompt text, tool name, event description) */
  summary: string
  /** tokens recorded for this entry, when the harness tracks them per message */
  tokens?: Partial<TokenCounts>
  /** cost recorded for this entry, when tracked */
  cost?: number
}

/** Full drill-down for one session. */
export interface Drilldown {
  harness: string
  sessionId: string
  title: string
  entries: DrillEntry[]
  /** true when the harness only exposes a bounded window (e.g. last N parts) */
  truncated?: boolean
}

/**
 * A harness adapter reads whatever traces a harness leaves on disk and
 * converts them into SessionInfo snapshots. Adapters must never control
 * the harness — they only observe. They must not throw from poll();
 * set lastError instead and return the previous (possibly empty) result.
 */
export interface Adapter {
  readonly harness: string
  /** Return true when the harness data directory exists on this machine. */
  available(): boolean
  /** Read all sessions known right now. */
  poll(): SessionInfo[]
  lastError: string | null
  /**
   * Optional: per-message timeline for one session (drill-down view).
   * Return null when the harness does not record message-level traces.
   */
  drilldown?(sessionId: string): Drilldown | null
}

/**
 * Sort keys. The four classic ones (burn/recent/tokens/cost) are bound to
 * keys 1-4; every column header is clickable and maps to one of these
 * (in/out/cacheR/rsn/cost/burn/age/harness/model/title/dir).
 */
export type SortKey =
  | "burn"  | "recent"
  | "tokens"
  | "cost"
  | "in"
  | "out"
  | "cacheR"
  | "rsn"
  | "age"
  | "harness"
  | "model"
  | "title"
  | "dir"
/** all valid SortKey values, for CLI validation */
export const SORT_KEYS: readonly SortKey[] = [
  "burn", "recent", "tokens", "cost", "in", "out", "cacheR", "rsn",
  "age", "harness", "model", "title", "dir",
]
export type GroupKey = "none" | "harness" | "model"
