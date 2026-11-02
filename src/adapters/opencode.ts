/**
 * OpenCode adapter — reads the session DB read-only.
 * See docs/ADR-003 for the data contract and caveats.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { Database } from "bun:sqlite"
import type { Adapter, Drilldown, DrillEntry, SessionInfo, TokenCounts } from "../types"

function normalizeModel(raw: unknown): string {
  if (raw == null) return "-"
  if (typeof raw === "object") {
    // already-parsed model object: { id, providerID, ... } (session_message.data)
    try {
      const j = raw as Record<string, unknown>
      const id = j.id ?? j.modelID ?? ""
      const prov = j.providerID ?? j.provider ?? ""
      return prov ? `${prov}/${id}` : String(id || "-")
    } catch {
      return "-"
    }
  }
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

  /**
   * Per-message timeline for one session, from `session_message` (+ optional
   * `session_part`). Current OpenCode versions store usage only as session
   * totals; per-message tokens are surfaced when present and omitted otherwise.
   */
  drilldown(sessionId: string): Drilldown | null {
    const db = this.open()
    if (!db) return null
    try {
      if (!this.hasTable(db, "session_message")) return null
      const meta = db
        .query("select id, title, slug from session_v2 where id = ?")
        .get(sessionId) as unknown as { id: string; title: string | null; slug: string } | null
      const title = meta ? (meta.title?.trim() || meta.slug || sessionId) : sessionId

      const rows = db
        .query(
          "select id, type, time_created, data from session_message where session_id = ? order by time_created, seq",
        )
        .all(sessionId) as unknown as { id: string; type: string; time_created: number; data: string }[]

      // optional part-level detail (tool calls with per-part usage, when recorded)
      const partRows = this.hasTable(db, "session_part")
        ? (db
            .query(
              "select message_id, type, time_created, data from session_part where session_id = ? order by time_created, ordinal",
            )
            .all(sessionId) as unknown as {
            message_id: string
            type: string
            time_created: number
            data: string
          }[])
        : []
      const partsByMessage = new Map<string, { type: string; time_created: number; data: string }[]>()
      for (const p of partRows) {
        const arr = partsByMessage.get(p.message_id)
        if (arr) arr.push(p)
        else partsByMessage.set(p.message_id, [p])
      }

      const entries: DrillEntry[] = []
      for (const r of rows) {
        let d: Record<string, unknown>
        try {
          d = JSON.parse(r.data) as Record<string, unknown>
        } catch {
          d = {}
        }
        // skip flow-control entries unless they carry summaries — keeps timelines readable
        if (r.type === "idle" && !d.content) continue
        const role = typeof d.role === "string" ? d.role : r.type
        const model = d.model != null ? normalizeModel(d.model) : undefined
        const rawCost = typeof d.cost === "number" ? d.cost : undefined
        const cost = rawCost && rawCost > 0 ? rawCost : undefined
        const tokens = extractTokens(d)

        // summarize: text content of the message, else part-derived, else type
        let summary = summaryFromContent(d.content)
        // parts: always scanned; text parts are covered by the message summary
        // (skipped), non-text parts (tool calls, steps) become their own entries
        const drillParts: DrillEntry[] = []
        for (const p of partsByMessage.get(r.id) ?? []) {
          let pd: Record<string, unknown>
          try {
            pd = JSON.parse(p.data) as Record<string, unknown>
          } catch {
            pd = {}
          }
          const partText = summaryFromContent(pd.content)
          if (partText && p.type === "text") continue // would duplicate the message summary
          const s = partText || summaryFromPart(pd)
          if (!s) continue // no signal — not worth a timeline entry
          const pt = extractTokens(pd)
          drillParts.push({
            time: p.time_created,
            role: p.type === "tool" ? "tool" : p.type,
            model: undefined,
            summary: s,
            tokens: pt && (pt.input || pt.output) ? pt : undefined,
            cost: typeof pd.cost === "number" ? pd.cost : undefined,
          })
        }
        const openWork = drillParts.filter((x) => !x.summary.endsWith("text"))
        if (!summary && drillParts.length === 1) summary = drillParts[0]!.summary
        const hasSignal = role === "user" || role === "assistant" || summary !== r.type
        if (hasSignal) {
          entries.push({
            time: r.time_created,
            role,
            model,
            summary: summary || r.type,
            tokens: tokens && (tokens.input || tokens.output) ? tokens : undefined,
            cost,
          })
        }
        if (summary && openWork.length > 0) entries.push(...openWork)
        else if (!summary && openWork.length > 1) entries.push(...openWork)
      }
      entries.sort((a, b) => a.time - b.time)

      this.lastError = null
      return {
        harness: this.harness,
        sessionId,
        title: title as string,
        entries,
        truncated: entries.length >= 1000,
      }
    } catch (e) {
      this.lastError = `drilldown: ${(e as Error).message}`
      return null
    }
  }
}

/** Find token counts under a usage-like object; both naming schemes. */
function extractTokens(d: Record<string, unknown>): Partial<TokenCounts> | undefined {
  const usage = (d.usage && typeof d.usage === "object" ? d.usage : null) as Record<string, unknown> | null
  // fall back to the object itself only when it *looks* like a usage record
  const src = usage ?? (isUsageShaped(d) ? d : null)
  if (!src) return undefined
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = src[k]
      if (typeof v === "number") return v
    }
    return undefined
  }
  const out: Partial<TokenCounts> = {
    input: num("tokens_input", "input_tokens", "input"),
    output: num("tokens_output", "output_tokens", "output"),
    reasoning: num("tokens_reasoning", "reasoning_tokens", "reasoning"),
    cacheRead: num("tokens_cache_read", "cache_read_input_tokens", "cacheRead"),
    cacheWrite: num("tokens_cache_write", "cache_write_input_tokens", "cacheWrite"),
  }
  const any = Object.values(out).some((v) => v != null)
  return any ? out : undefined
}

/** True when the object carries at least one recognized token-counter key. */
function isUsageShaped(d: Record<string, unknown>): boolean {
  const keys = [
    "tokens_input", "input_tokens",
    "tokens_output", "output_tokens",
    "tokens_cache_read", "cache_read_input_tokens",
  ]
  return keys.some((k) => typeof d[k] === "number")
}

/** First meaningful text from an OpenCode content array; prefers prose (type "text") over reasoning. */
function summaryFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ""
  const textOf = (part: Record<string, unknown>): string =>
    typeof part.text === "string" && part.text.trim()
      ? part.text.trim().replace(/\s+/g, " ").slice(0, 120)
      : ""
  for (const part of content) {
    if (part && typeof part === "object" && (part as Record<string, unknown>).type === "text") {
      const s = textOf(part as Record<string, unknown>)
      if (s) return s
    }
  }
  for (const part of content) {
    if (part && typeof part === "object") {
      const s = textOf(part as Record<string, unknown>)
      if (s) return s
    }
  }
  return ""
}

/** Human label for a non-text part (tool state, step transition, …). */
function summaryFromPart(p: Record<string, unknown>): string {
  if (typeof p.tool === "string") return `tool: ${p.tool}`
  if (typeof p.state === "string") return `state: ${p.state}`
  if (typeof p.status === "string") return `status: ${p.status}`
  return ""
}
