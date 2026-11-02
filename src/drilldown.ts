/**
 * Drill-down rendering: per-message timeline for one session.
 * Shared by the headless dump (`tktop-dump --drill <s>`) and the TUI overlay.
 */
import type { DrillEntry, Drilldown } from "./types"
import { fmtCost, fmtTokens } from "./format"

/** Time (HH:MM:SS) for an epoch-ms entry. */
function hhmmss(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((x) => String(x).padStart(2, "0"))
    .join(":")
}

/** Compact token/cost suffix for an entry, e.g. " · 1.2K→3.4K · $0.05". */
function tokenSuffix(e: DrillEntry): string {
  const t = e.tokens
  if (!t || (!t.input && !t.output)) return e.cost != null ? ` · ${fmtCost(e.cost)}` : ""
  const i = t.input ? `${fmtTokens(t.input)}→` : ""
  const o = fmtTokens(t.output ?? 0)
  const cost = e.cost != null ? ` · ${fmtCost(e.cost)}` : ""
  return ` · ${i}${o} out${cost}`
}

/** Plain-text line for one entry (headless mode). */
export function drillEntryLine(e: DrillEntry, width = 0): string {
  const tag = `${hhmmss(e.time)} ${e.role}`
  const model = e.model ? ` [${e.model}]` : ""
  const line = `  ${tag.padEnd(22)}${e.model ? model + " " : ""}${e.summary}${tokenSuffix(e)}`
  return width > 0 ? line.slice(0, width) : line
}

/** Header line for the headless drill-down output. */
export function drillHeader(d: Drilldown): string {
  return `drill-down: ${d.harness} · ${d.title} (${d.sessionId}) · ${d.entries.length} entries${d.truncated ? " (truncated)" : ""}`
}

/** Render the whole headless drill-down text. */
export function renderDrilldown(d: Drilldown, maxEntries = 100): string[] {
  const lines = [drillHeader(d), "─".repeat(Math.min(100, drillHeader(d).length))]
  const entries = [...d.entries].reverse() // most recent first
  for (const e of entries.slice(0, maxEntries)) lines.push(drillEntryLine(e))
  const cut = entries.length - maxEntries
  if (cut > 0) lines.push(`  … ${cut} older entries`)
  return lines
}
