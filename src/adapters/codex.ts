/**
 * Codex CLI adapter — cumulative token_count events in
 * ~/.codex/sessions JSONL files ("latest" semantics). See docs/ADR-003.
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

export class CodexAdapter implements Adapter {
  readonly harness = "codex"
  lastError: string | null = null

  private root: string
  private tail: JsonlTail
  private accs = new Map<string, Acc>()
  private started = false

  constructor(root?: string) {
    this.root = root ?? `${homedir()}/.codex/sessions`
    this.tail = new JsonlTail(`${this.root}/**/*.jsonl`)
  }

  available(): boolean {
    return existsSync(this.root)
  }

  poll(): SessionInfo[] {
    try {
      if (!this.started) {
        this.tail.refreshFiles()
        this.started = true
      } else if (Math.random() < 0.05) {
        this.tail.refreshFiles()
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
    const payload = obj.payload

    // session id: prefer payload.session_meta.id, else file stem
    let sid: string | null = null
    if (payload?.type === "session_meta" && payload.id) sid = String(payload.id)
    if (!sid) {
      const m = path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)
      if (m?.[1]) sid = m[1]
    }
    if (!sid) return

    let acc = this.accs.get(sid)
    if (!acc) {
      acc = newAcc(sid)
      this.accs.set(sid, acc)
    }

    const ts = obj.timestamp ? (typeof obj.timestamp === "number" ? obj.timestamp : Date.parse(obj.timestamp)) : 0
    if (ts > acc.timeUpdated) acc.timeUpdated = ts
    if (acc.timeCreated === 0 || (ts > 0 && ts < acc.timeCreated)) acc.timeCreated = ts

    const p = payload ?? {}
    if (p.cwd) acc.directory = String(p.cwd)
    if (p.model) acc.model = String(p.model)

    if (p.type === "token_count") {
      const info = p.info ?? p
      // cumulative totals: overwrite, never sum
      const total = info.total_token_usage ?? info.totalTokenUsage ?? info.usage
      if (total && typeof total === "object") {
        const pick = (...names: string[]): number => {
          for (const n of names) if (typeof total[n] === "number") return total[n]
          return 0
        }
        acc.tokens.input = pick("input_tokens", "inputTokens", "input")
        acc.tokens.cacheRead = pick("cached_input_tokens", "cachedInputTokens", "cache_read", "cached")
        acc.tokens.output = pick("output_tokens", "outputTokens", "output")
        acc.tokens.reasoning = pick("reasoning_output_tokens", "reasoning_tokens", "reasoningOutputTokens", "reasoning")
      }
    } else if (p.type === "turn_context" && p.model) {
      acc.model = String(p.model)
    }
  }
}
