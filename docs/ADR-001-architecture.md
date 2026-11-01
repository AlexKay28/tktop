# ADR-001: Core architecture — observe harness side-effects, don't integrate into harnesses

- Status: accepted
- Date: 2026-11-01

## Context

"N harnesses on one VM" — every harness persists session metadata *somewhere* on disk, in a
format the harness itself already guarantees (it is the system of record for its own usage data).
We must not require any cooperation from the harnesses: no flags, no plugins, no hooks, nothing to
install into them. We also must survive harness updates changing their storage layouts — that is an
adapter concern, isolated from the rest of the app.

## Decision

Three-layer pipeline, all in-process:

```
┌─────────────┐  poll()       ┌────────────┐  snapshot   ┌──────────────┐
│  Adapters   │ ────────────▶ │   Store    │ ──────────▶ │  TUI (view)  │
│ per harness │  SessionInfo[]│ dedupe,    │  derived    │  OpenTUI     │
└─────────────┘               │ rates,     │  rows       └──────────────┘
                              │ history    │
                              └────────────┘
```

1. **Adapters** (`src/adapters/`) — one class per harness, implementing:

   ```ts
   interface Adapter {
     harness: string
     available(): boolean      // does this harness exist on this machine?
     poll(): SessionInfo[]     // all sessions visible right now
     lastError: string | null  // adapters must not throw; they report errors
   }
   ```

   Adapters read **read-only** (SQLite in read-only mode, JSONL via incremental tail reads) and
   are required to be side-effect-free. A failing adapter degrades to its previous snapshot and
   surfaces the error in the footer; it never takes down the TUI.

2. **Store** (`src/store.ts`) — the single stateful hub:
   - polls every adapter every N ms (default 2000),
   - merges snapshots by stable session key `${harness}:${id}`,
   - diffs **cumulative** token counters between polls → per-session burn rate
     (`output + reasoning tokens per minute`), EMA-smoothed (α = 0.4),
   - keeps a short ring buffer of rate samples per session for sparklines,
   - owns view knobs: sort key, filter substring, group-by mode, archived visibility.

3. **TUI** (`src/ui.ts`) — a pure projection of store state:
   - rebuilds header/rows/footer contents from the latest derived snapshot,
   - row pool reuses `TextRenderable` nodes instead of recreating the tree every tick,
   - manual htop-style viewport (cursor + offset), no scroll component needed.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Harness hooks/plugins** (e.g. OpenCode hooks, Claude hooks) | Invasive; requires per-harness setup; harness must cooperate; breaks "observe only" principle; brittle across versions. |
| **Network API / webhooks from harnesses** | Same cooperation problem plus network plumbing; harnesses run locally. |
| **Sniffing process stdio / proxying provider APIs** | Requires launching harnesses *through* tktop or MITM-ing TLS — heavyweight, fragile, and changes harness behavior. |
| **One parser hardcoded per format in the UI** | Blocks multi-harness support and testing without a terminal. The adapter boundary lets `--once` mode (dump to stdout) exercise the whole data pipeline in CI/shell. |

## Consequences

- Adding a harness = writing one adapter (+ auto-detection of its data directory).
- Burn rate is *derived, not stored*: it is accurate for as long as tktop keeps running, and
  resets on restart (documented behavior, matching "monitor on the fly" usage).
- Adapters depend on harness storage layouts; a harness update may require an adapter update —
  contained, testable, and visible via adapter `lastError`.
