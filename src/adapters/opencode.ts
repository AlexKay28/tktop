/**
 * OpenCode adapter — reads the session DB read-only.
 * See docs/ADR-003 for the data contract and caveats.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { Database } from "bun:sqlite"
import type { Adapter, SessionInfo, TokenCounts } from "../types"

function normalizeModel(raw: unknown): string {
  if (raw == null) return "-"
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      const j = JSON.parse(raw)
      const id = j.id ?? j.modelID ?? ""
      const prov = j.providerID ?? j.provider ?? ""
      return prov ? `${prov}/${id}` : id
    } catch {
      return String(raw)
    }
  }
  return String(raw)
}

interface Row {
  id: string
  title: string | null
  slug: string
  directory: string
  model: string | null
  agent: string | null
  parent_id?: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  time_created: number
  time_updated: number
  time_archived: number | null
}

export class OpenCodeAdapter implements Adapter {
  readonly harness = "opencode"
  lastError: string | null = null

  private dbPath: string
  private db: Database | null = null

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? `${homedir()}/.local/share/opencode/opencode.db`
  }

  available(): boolean {
    return existsSync(this.dbPath)
  }

  private open(): Database | null {
    if (this.db) return this.db
    try {
      this.db = new Database(this.dbPath, { readonly: true })
      return this.db
    } catch (e) {
      this.lastError = `open db: ${(e as Error).message}`
      return null
    }
  }

  private hasTable(db: Database, name: string): boolean {
    const r = db.query("select name from sqlite_master where type='table' and name=?").get(name)
    return !!r
  }

  private hasColumn(db: Database, table: string, col: string): boolean {
    const cols = db.query(`pragma table_info(${table})`).all() as unknown as { name?: string }[]
    return cols.some((c) => c.name === col)
  }

  poll(): SessionInfo[] {
    const db = this.open()
    if (!db) return []
    try {
      const table = this.hasTable(db, "session_v2") ? "session_v2" : this.hasTable(db, "session") ? "session" : null
      if (!table) {
        this.lastError = "no session table in opencode.db"
        return []
      }
      const parentIdCol = this.hasColumn(db, table, "parent_id") ? ", parent_id" : ""
      const rows = db
        .query(
          `select id, title, slug, directory, model, agent${parentIdCol}, cost,
                  tokens_input, tokens_output, tokens_reasoning,
                  tokens_cache_read, tokens_cache_write,
                  time_created, time_updated, time_archived
           from ${table}`,
        )
        .all() as unknown as Row[]

      const out: SessionInfo[] = []
      for (const r of rows) {
        const tokens: TokenCounts = {
          input: r.tokens_input ?? 0,
          output: r.tokens_output ?? 0,
          reasoning: r.tokens_reasoning ?? 0,
          cacheRead: r.tokens_cache_read ?? 0,
          cacheWrite: r.tokens_cache_write ?? 0,
        }
        out.push({
          key: `${this.harness}:${r.id}`,
          harness: this.harness,
          id: r.id,
          title: (r.title && r.title.trim()) || r.slug || r.id.slice(0, 12),
          directory: r.directory ?? "",
          model: normalizeModel(r.model),
          agent: r.agent ?? undefined,
          parentId: r.parent_id ?? null,
          archived: r.time_archived != null,
          tokens,
          cost: r.cost ?? 0,
          timeCreated: r.time_created,
          timeUpdated: r.time_updated,
        })
      }
      this.lastError = null
      return out
    } catch (e) {
      this.lastError = (e as Error).message
      return []
    }
  }
}
