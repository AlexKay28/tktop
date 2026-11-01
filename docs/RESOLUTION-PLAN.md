# tktop — Backbone & Resolution Plan

## Project backbone

```
tktop/
├── bin/tktop                  # launcher shim (bun run) → ~/.local/bin
├── src/
│   ├── index.ts                 # entry: CLI args, createCliRenderer, App wiring
│   ├── dump.ts                  # headless table dump: poll once, print (no TUI) (test harness)
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
  `◆ marker │ harness │ model │ session title │ dir │ in │ out │ cache-R │ rsn │ cost │ tok/min │ spark │ age`
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
- **checkpoint: `tktop` renders live session table in a terminal ✅ (verified under pty)**

### Phase 3 — Interactivity (✅ complete)
- [x] Filter mode (`/` + InputRenderable, escape/enter, hotkeys gated by mode)
- [x] Group-by (`g`: none → harness → model) with subtotal separator rows
- [x] Archived toggle (`a`), help overlay (`?`), error surfacing in footer/status line
- **checkpoint: full keyboard contract works ✅**

### Phase 4 — Polish & packaging (✅ complete)
- [x] Resize handling (renderer `resize` event re-renders), narrow-terminal column drop priorities
- [x] `bin/tktop` shim + `~/.local/bin` symlink; README with usage + extension guide
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

### Phase 5 — v0.3.0 additions (✅ shipped)
- [x] Complete rename to **tktop** (npm name, bin command, all user-facing text; config moves to
      `~/.config/tktop/`). UI sweep: column sizing now accounts for the rows-box padding (rightmost
      AGE column was clipped), sticky header no longer +1 cell off. All harness adapters
      fixture-verified (38/38: claude incremental, codex latest/no-double-count, generic
      additive+latest). npm packaging (files whitelist, engines.bun, prepublishOnly typecheck);
      publish workflow `.github/workflows/publish.yml` (tag-triggered, NPM_TOKEN secret).
- [x] **Clickable TUI**: click any sortable column header to sort (▼ desc / ▲ asc indicator,
      accent-colored; click again to reverse), click a row to move the selection cursor there,
      mouse wheel scrolls the table. Verified end-to-end with real SGR mouse sequences via tmux.
      `SortKey` extended to every column (in/out/cacheR/rsn/age/harness/model/title/dir) with
      explicit sort direction; text columns default A→Z, value columns default biggest-first.

### Phase 5 — v0.3.1 additions (✅ shipped)
- [x] **PyPI distribution**: `pip install tktop-tui` publishes as [tktop-tui on PyPI](https://pypi.org/project/tktop-tui/)
      ("tktop" itself was taken there by an unrelated Python project). The wheel bundles src/+bin/
      (staged by `python/sync.sh` at build time, gitignored); the `tktop` console script stages the
      app into `~/.local/share/tktop/<version>/`, `bun install --production`s once, and execs the
      TUI — read-only site-packages are never touched. Verified clean-room: pip install from PyPI,
      first-run staging + dep fetch, TUI boots (exit 124 under timeout).

### Phase 5 — v0.3.3 additions (✅ shipped)
- [x] **Tree view (`t`)**: htop-style nesting of subagent sessions under their parent session.
      OpenCode exposes `parent_id` per session (adapter reads it, guarded for older schemas);
      Store builds a DFS display list (hidden when flat), promotes filtered-out parents' children,
      breaks parent cycles safely; UI renders `├─`/`└─` branch glyphs with indentation. Sort order
      and dir apply at every tree level. Verified live: this session's two subagents nest under
      TOKFLOW. Unit suite 5/5 (DFS order, depths, isLast, cycle, flat toggle).

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
