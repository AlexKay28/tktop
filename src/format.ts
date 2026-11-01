/** Formatting helpers: numbers, time, sparklines, and cell padding. */

const BOLD_RESET = "\u001b[0m"

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "-"
  if (n < 1000) return String(n)
  if (n < 1_000_000) return (n / 1e3).toFixed(1) + "K"
  if (n < 1_000_000_000) return (n / 1e6).toFixed(2) + "M"
  return (n / 1e9).toFixed(2) + "G"
}

export function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "-"
  if (n < 0.01) return "$" + n.toFixed(4)
  if (n < 100) return "$" + n.toFixed(2)
  return "$" + Math.round(n).toLocaleString("en-US")
}

export function fmtRate(perMin: number): string {
  if (!Number.isFinite(perMin) || perMin <= 0) return "-"
  if (perMin < 10) return perMin.toFixed(1)
  return fmtTokens(Math.round(perMin))
}

/** Age of a timestamp in compact human form. */
export function fmtAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000))
  if (s < 60) return s + "s"
  const m = Math.floor(s / 60)
  if (m < 60) return m + "m"
  const h = Math.floor(m / 60)
  if (h < 24) return h + "h"
  const d = Math.floor(h / 24)
  if (d < 30) return d + "d"
  return Math.floor(d / 30) + "mo"
}

const SPARK_CHARS = [" ", "▁", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
const SPARK_FULL = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/** Render a sparkline of the series into `width` cells. */
export function sparkline(values: number[], width: number): string {
  const w = Math.max(1, width)
  if (values.length === 0) return " ".repeat(w)
  const recent = values.slice(-w)
  const max = Math.max(...recent, 1)
  const out: string[] = []
  for (let i = 0; i < w - recent.length; i++) out.push(" ")
  for (const v of recent) {
    if (v <= 0) {
      out.push(" ")
      continue
    }
    // map v/max ∈ (0,1] to levels 1..8 of SPARK_FULL
    const level = Math.max(1, Math.min(SPARK_FULL.length, Math.ceil((v / max) * SPARK_FULL.length)))
    out.push(SPARK_FULL[level - 1] ?? " ")
  }
  return out.join("")
}

/** Truncate a string to width cells, appending an ellipsis when cut. */
export function fit(s: string, width: number): string {
  const str = s ?? ""
  if (str.length <= width) return str
  if (width <= 1) return str.slice(0, width)
  return str.slice(0, width - 1) + "…"
}

/** Pad to exact cell width, truncating when needed. */
export function cell(s: string, width: number, align: "left" | "right" = "left"): string {
  const str = fit(String(s ?? ""), Math.max(0, width))
  return align === "right" ? str.padStart(width) : str.padEnd(width)
}

export function shortDir(dir: string, width: number): string {
  const s = String(dir ?? "")
  const home = (globalThis as any).process?.env?.HOME
  let out = s
  if (home && out.startsWith(home)) out = "~" + out.slice(home.length)
  return out
}

export function totalTokens(t: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }): number {
  return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite
}
