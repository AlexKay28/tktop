/**
 * Adapter registry — instantiate everything, keep what's available.
 */
import type { Adapter } from "../types"
import { OpenCodeAdapter } from "./opencode"
import { ClaudeCodeAdapter } from "./claude-code"
import { CodexAdapter } from "./codex"
import { GenericJsonlAdapter, loadGenericConfig } from "./generic-jsonl"

export function buildAdapters(configPath?: string): Adapter[] {
  const builtins: Adapter[] = [new OpenCodeAdapter(), new ClaudeCodeAdapter(), new CodexAdapter()]
  let generic: Adapter[] = []
  try {
    generic = loadGenericConfig(configPath).map((c) => new GenericJsonlAdapter(c))
  } catch {
    generic = []
  }
  const all = [...builtins, ...generic]
  return all.filter((a) => {
    try {
      return a.available()
    } catch {
      return false
    }
  })
}
