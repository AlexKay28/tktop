/**
 * Claude Code adapter — additive parsing of JSONL files under ~/.claude/projects.
 * Auto-activates when ~/.claude exists. See docs/ADR-003 for caveats.
 */
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import type { Adapter, SessionInfo, TokenCounts } from "../types"
import { JsonlTail } from "./jsonl-tail"

interface Acc {
  id: string
  title: string
  directory: string
  model: string
  tokens: TokenCounts
  cost: number
  timeCreated: number
  timeUpdated: number
}

function newAcc(id: string): Acc {
  return {
    id,
    title: "",
    directory: "",
    model: "-",
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    timeCreated: 0,
    timeUpdated: 0,
  }
}

export class ClaudeCodeAdapter implements Adapter {
  readonly harness = "claude-code"
  lastError: string | null = null

  private root: string
  private tail: JsonlTail
  private accs = new Map<string, Acc>()
  private started = false

  constructor(root?: string) {
    this.root = root ?? `${homedir()}/.claude/projects`
    this.tail = new JsonlTail(`${this.root}/**/*.jsonl`)
  }

  available(): boolean {
    return existsSync(this.root)
  }

  private sid(obj: any, path: string): string {
    if (obj.sessionId) return String(obj.sessionId)
    const m = path.match(/([0-9a-f-]{36})(?:\.jsonl)?$/i)
    if (m?.[1]) return m[1]
    return path
  }

  poll(): SessionInfo[] {
    try {
      if (!this.started) {
        this.tail.refreshFiles()
        this.started = true
      } else if (this.accs.size === 0 || Math.random() < 0.05) {
        // occasionally re-scan for new project files
        this.tail.refreshFiles()
      }

      this.tail.read((obj, path) => this.onLine(obj, path))

      const out: SessionInfo[] = []
      const now = Date.now()
      for (const [sid, a] of this.accs) {
        out.push({
          key: `${this.harness}:${sid}`,
          harness: this.harness,
          id: sid,
          title: a.title || (a.directory ? a.directory.split("/").filter(Boolean).pop() || sid.slice(0, 12) : sid.slice(0, 12)),
          directory: a.directory,
          model: a.model || "-",
          archived: false,
          tokens: a.tokens,
          cost: a.cost,
          timeCreated: a.timeCreated || a.timeUpdated,
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
    const sid = this.sid(obj, path)
    let acc = this.accs.get(sid)
    if (!acc) {
      acc = newAcc(sid)
      this.accs.set(sid, acc)
    }

    const ts = obj.timestamp ? (typeof obj.timestamp === "number" ? obj.timestamp : Date.parse(obj.timestamp)) : 0
    if (ts > acc.timeUpdated) acc.timeUpdated = ts
    if (acc.timeCreated === 0 || (ts > 0 && ts < acc.timeCreated)) acc.timeCreated = ts
    if (obj.cwd) acc.directory = String(obj.cwd)

    if (obj.type === "summary" && obj.summary) {
      if (!acc.title) acc.title = String(obj.summary)
      return
    }

    const msg = obj.message
    if (!msg || typeof msg !== "object") return

    if (obj.type === "user" && !acc.title) {
      const c = msg.content
      const text =
        typeof c === "string"
          ? c
          : Array.isArray(c)
            ? (c.find((p: any) => p?.type === "text")?.text ?? "")
            : ""
      if (text) acc.title = text.replace(/\s+/g, " ").slice(0, 80)
      return
    }

    if (obj.type === "assistant") {
      if (msg.model) acc.model = String(msg.model)
      const u = msg.usage
      if (u && typeof u === "object") {
        acc.tokens.input += u.input_tokens ?? 0
        acc.tokens.output += u.output_tokens ?? 0
        acc.tokens.cacheRead += u.cache_read_input_tokens ?? 0
        acc.tokens.cacheWrite += u.cache_creation_input_tokens ?? 0
        // some history formats fold reasoning into output; record if present
        acc.tokens.reasoning += u.reasoning_tokens ?? 0
      }
      if (typeof obj.costUSD === "number") acc.cost += obj.costUSD
    }
  }
}
