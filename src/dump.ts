/**
 * Headless mode: poll once and print the table to stdout.
 * Usage: bun run src/dump.ts [--all] [--filter s] [--sort burn|recent|tokens|cost]
 * This is the data-layer checkpoint from docs/RESOLUTION-PLAN.md Phase 1.
 */
import { buildAdapters } from "./adapters/registry"
import { Store } from "./store"
import { cell, fmtAgo, fmtCost, fmtRate, fmtTokens, shortDir, totalTokens } from "./format"

const args = process.argv.slice(2)
const flag = (name: string): string | null => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? "") : null
}

const store = new Store(buildAdapters(), 2000)
store.showArchived = args.includes("--all")
const f = flag("--filter")
if (f) store.filter = f
const s = flag("--sort")
if (s && ["burn", "recent", "tokens", "cost"].includes(s)) store.sortKey = s as any

await store.tick()
await new Promise((r) => setTimeout(r, 700)) // seed a real time delta for rate computation
await store.tick()

const adapters = store.adaptersLive
const errors = store.adapterErrors
const rows = store.rows()
const totals = store.totals(rows)

const W = process.stdout.columns ?? 140
const dirw = Math.max(10, Math.min(24, Math.floor(W * 0.14)))
const titlew = Math.max(16, W - dirw - 9 - 17 - 9 - 9 - 9 - 7 - 8 - 9 - 7 - 12)

const hdr =
  cell("HARNESS", 9) +
  cell("MODEL", 20) +
  cell("SESSION", titlew) +
  cell("DIR", dirw) +
  cell("IN", 9, "right") +
  cell("OUT", 9, "right") +
  cell("CACHE-R", 9, "right") +
  cell("RSN", 7, "right") +
  cell("COST", 8, "right") +
  cell("TOK/MIN", 9, "right") +
  cell("AGE", 9, "right")

console.log(`tokflow — adapters: ${adapters.map((a) => `${a.harness}`).join(", ") || "none detected"}`)
console.log(
  `sessions ${totals.sessions} (active ${totals.active}) · ` +
    `in ${fmtTokens(totals.tokens.input)} · out ${fmtTokens(totals.tokens.output)} · ` +
    `cache-r ${fmtTokens(totals.tokens.cacheRead)} · rsn ${fmtTokens(totals.tokens.reasoning)} · ` +
    `cost ${fmtCost(totals.cost)} · burn ${fmtRate(totals.burnRate)} tok/min`,
)
console.log("─".repeat(Math.min(W, hdr.length)))
console.log(hdr)
console.log("─".repeat(Math.min(W, hdr.length)))
for (const r of rows.slice(0, Math.max(10, (process.stdout.rows ?? 40) - 8))) {
  const line =
    cell(r.harness, 9) +
    cell(r.model, 20) +
    cell(r.title, titlew) +
    cell(shortDir(r.directory, dirw), dirw) +
    cell(fmtTokens(r.tokens.input), 9, "right") +
    cell(fmtTokens(r.tokens.output), 9, "right") +
    cell(fmtTokens(r.tokens.cacheRead), 9, "right") +
    cell(fmtTokens(r.tokens.reasoning), 7, "right") +
    cell(fmtCost(r.cost), 8, "right") +
    cell(fmtRate(r.burnRate), 9, "right") +
    cell(fmtAgo(r.timeUpdated), 9, "right")
  console.log(line)
}
if (rows.length > 36) console.log(`… ${rows.length - 36} more`)
if (errors.length) {
  console.error("adapter errors:\n  " + errors.join("\n  "))
}
console.log(`total tokens (all visible): ${fmtTokens(totalTokens(totals.tokens))}`)
