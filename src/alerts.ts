/**
 * Budget alerts: thresholds from ~/.config/tktop/config.json.
 *
 *   { "alerts": { "burnTokPerMin": 5000, "sessionCost": 1.0, "sessionTokens": 1_000_000 } }
 *
 * Thresholds are per-session; unset keys are simply not checked. Evaluation is
 * pure (rows + thresholds in, alerts out) so it is unit-testable.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import type { SessionRow } from "./store"
import { fmtCost, fmtRate, fmtTokens, totalTokens } from "./format"

export interface AlertThresholds {
  /** live burn rate per session, tokens/min (input+output+reasoning) */
  burnTokPerMin?: number
  /** cumulative cost per session, in the harness's currency units */
  sessionCost?: number
  /** cumulative total tokens per session (in+out+reasoning+cache, as in the totals line) */
  sessionTokens?: number
}

export interface AlertConfigFile {
  alerts?: AlertThresholds
}

export interface Alert {
  kind: "burn" | "cost" | "tokens"
  key: string
  title: string
  message: string
}

const DEFAULT_CONFIG = `${homedir()}/.config/tktop/config.json`

/** Load thresholds from the config file; missing file/keys → no thresholds. */
export function loadAlertThresholds(path = DEFAULT_CONFIG): AlertThresholds {
  try {
    if (!existsSync(path)) return {}
    const j = JSON.parse(readFileSync(path, "utf8")) as AlertConfigFile
    return j.alerts ?? {}
  } catch {
    return {}
  }
}

/** Pure evaluation: which sessions currently exceed which thresholds. */
export function evaluateAlerts(
  rows: Pick<SessionRow, "key" | "title" | "burnRate" | "cost" | "tokens">[],
  t: AlertThresholds,
): Alert[] {
  const out: Alert[] = []
  for (const r of rows) {
    if (t.burnTokPerMin != null && r.burnRate > t.burnTokPerMin) {
      out.push({
        kind: "burn",
        key: r.key,
        title: r.title,
        message: `${r.title}: burning ${fmtRate(r.burnRate)} tok/min (threshold ${fmtRate(t.burnTokPerMin)})`,
      })
    }
    if (t.sessionCost != null && r.cost > t.sessionCost) {
      out.push({
        kind: "cost",
        key: r.key,
        title: r.title,
        message: `${r.title}: cost ${fmtCost(r.cost)} (threshold ${fmtCost(t.sessionCost)})`,
      })
    }
    if (t.sessionTokens != null && totalTokens(r.tokens) > t.sessionTokens) {
      out.push({
        kind: "tokens",
        key: r.key,
        title: r.title,
        message: `${r.title}: ${fmtTokens(totalTokens(r.tokens))} tokens (threshold ${fmtTokens(t.sessionTokens)})`,
      })
    }
  }
  return out
}
