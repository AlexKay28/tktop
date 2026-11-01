# tokflow — Backbone & Resolution Plan

## Project backbone

```
tokflow/
├── bin/tokflow                  # launcher shim (bun run) → ~/.local/bin
├── src/
│   ├── index.ts                 # entry: CLI args, createCliRenderer, App wiring
│   ├── dump.ts                  # headless `--once` mode: poll once, print table (test harness)
│   ├── types.ts                 # SessionInfo / Adapter / SortKey / GroupKey contracts
│   ├── store.ts                 # polling loop, rate derivation (EMA), history, view knobs
│   ├── format.ts                # number/cost/age formatting, sparklines, cell padding
│   ├── ui.ts                    # OpenTUI App: header, pooled rows, footer, help overlay
│   └── adapters/
│       ├── registry.ts          # detect + instantiate all adapters (+config sources)
│       ├── opencode.ts          # SQLite session_v2 (read-only)
│       ├── claude-code.ts        # ~/.claude/projects JSONL (additive, tailed)
│       ├── codex.ts             # ~/.codex/sessions JSONL (latest, tailed)
│       ├── generic-jsonl.ts      # operator config-driven sources
│       └── jsonl-tail.ts         # shared incremental tail reader (cursor + partial-line buffer)
└── docs/                        # GOAL, ADR-001..003, this plan
```

Data contract (the backbone's load-bearing wall):

```
Adapter.poll() ─ SessionInfo[]
  .key          stable "${harness}:${id}"
  .tokens       { input, output, reasoning, cacheRead, cacheWrite }   cumulative
  .cost, .timeCreated, .timeUpdated, .model, .title, .directory, .archived

Store (2s tick):
  for each adapter: poll, catch → keep last good
  merge by key → SessionRow {
    burnRate    EMA of Δ(output+reasoning) per minute   ← derived live
    history[]   ring of rate samples (sparkline)
  }
  apply: sortKey, filter, groupBy, showArchived → render order
```

## UI contract

- Line 1..2 (header): totals — sessions (active/total), tokens in/out/cache-R, cost, aggregate
  burn rate; adapter status/errors.
- Body: one row per session. Columns (adaptive, dropped by priority on narrow terminals):
  `▸ harness │ model │ session title │ dir │ in │ out │ cache-R │ rsn │ cost │ tok/min │ spark │ age`
- Footer: mode/status line (filter input mounts here) + hotkey bar.
- Keys: `1..4` sort (burn/recent/tokens/cost) · `/` filter · `g` group-by · `a` archived ·
  `j/k ↑/down PgUp/PgDn` navigate · `?` help · `r` refresh · `q` quit.

## Resolution plan

### Phase 0 — Environment (✅ done)
- Bun installed (`~/.bun`), `@opentui/core` dependency resolves and loads native artifacts.
- Verified read-only WAL access to OpenCode's db and real data (770 sessions).

### Phase 1 — Data backbone (✅ complete)
- [x] `types.ts`, `format.ts` (contracts + formatting)
- [x] `jsonl-tail.ts`, adapters: opencode → claude → codex → generic
- [x] `store.ts` (merge, rates, EMA, history, view knobs)
- [x] `dump.ts` headless table — **checkpoint: `bun run dump` shows live session stats ✅ (787 sessions live)**

### Phase 2 — TUI MVP (✅ complete)
- [x] `ui.ts`: layout tree (header / pooled rows / footer / help overlay), tick integration
- [x] Sorting (`1..4`), navigation keys (j/k/arrows/PgUp/PgDn/Home/End), quit; adaptive columns
- **checkpoint: `tokflow` renders live session table in a terminal ✅ (verified under pty)**

### Phase 3 — Interactivity (✅ complete)
- [x] Filter mode (`/` + InputRenderable, escape/enter, hotkeys gated by mode)
- [x] Group-by (`g`: none → harness → model) with subtotal separator rows
- [x] Archived toggle (`a`), help overlay (`?`), error surfacing in footer/status line
- **checkpoint: full keyboard contract works ✅**

### Phase 4 — Polish & packaging (✅ complete)
- [x] Resize handling (renderer `resize` event re-renders), narrow-terminal column drop priorities
- [x] `bin/tokflow` shim + `~/.local/bin` symlink; README with usage + extension guide
- [x] `--interval`, `--all`, `--filter`, `--sort` CLI flags; `bun run typecheck` clean
- **checkpoint: daily-usable tool ✅**

### Phase 5 — v0.2.0 additions (✅ shipped)
- [x] Live scatterplot above the table (htop-style): x = in+out tokens (log scale, decade ticks),
      y = tok/min; one colored dot per active session with a trail behind it; afterglow — a
      finished session's dot stays dim for 15s, then disappears. Toggle with `p`.
  - Store owns `tracks` (per-session point rings, `input+output` vs burn rate); UI renders a
    pooled cell canvas to styled runs. Details in ADR-001 layering: tracks are derived data,
    persisted only in-memory, per-run.

### Phase 5 — v0.2.1 additions (✅ shipped)
- [x] Per-session scatter markers: 8 glyphs (`● ★ ✖ ◆ ▲ ✚ ■ ✦`) × 8-color palette, assigned
      deterministically (separate hash seeds so glyph/color don't correlate). Scatter heads and
      the new table legend column (`◆`) show the same marker+color; `·` when no live dot.

### Phase 5 — Future candidates (not committed)
- Per-message drill-down (Enter opens a session detail pane; needs `session_part` parsing)
- Budget/alerts: notify when rate or session cost crosses threshold
- `@opentui/ssh` server mode for watching a VM from a laptop
- `bun build --compile` standalone binary; config for adapters auto-discovery paths

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Harness storage format changes on update | Adapter isolation + `lastError` surfacing; cheap to fix, UI untouched |
| WAL read contention / locked db | Read-only connections; errors degrade to previous snapshot |
| Big JSONL logs → slow polls | Incremental tail cursors (byte offsets, partial-line buffer) |
| Miscounting on rotate/restart | Documented semantics: `latest` idempotent; `additive` ± once per launch |
| Unformatted/failing adapter NaNs | `format.ts` renders `–`, never fake zeros |
