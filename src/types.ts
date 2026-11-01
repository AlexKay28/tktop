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
}

export type SortKey = "burn" | "recent" | "tokens" | "cost"
export type GroupKey = "none" | "harness" | "model"
