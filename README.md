# tktop

Live terminal dashboard (htop-style) for **AI token consumption** across coding-harness sessions on this machine.
Built with [OpenTUI](https://opentui.com) + Bun. Observe-only: tktop never controls harnesses, it reads the traces they already leave on disk.

```
 tktop  AI token consumption monitor · runtime: opencode · 17:47:03
 sessions 816 (15 active) · in 26.96M out 2.68M cache-r 346.49M rsn 100.2K cost - burn 1.1K tok/min
┌─ scatter · x: tokens(in+out, log) · y: tok/min · 15 dots ───────────────────────┐
│      ·                 ·        ●   ·                                           │
│1K                     10K                  100K                    1M           │
└────────────────────────────────────────────────────────────────────────────────┘
 HARNESS   MODEL           SESSION      DIR         IN      OUT  ...  TOK/MIN  RATE
 opencode  eliza/glm-5-3  TKTOP        ~/tktop   58.2K   88.3K  ...   767     ▅▃▂▂▁█
```

## Live scatterplot (htop-style, above the table)

- **x axis** = cumulative `input + output` tokens for the session, **logarithmic** (decade labels).
- **y axis** = burn rate (tok/min).
- Every **active session is a colored dot**: an 8-glyph marker set (`● ★ ✖ ◆ ▲ ✚ ■ ✦`) crossed with an
  8-color palette (assigned deterministically per session). Its recent history is drawn as a `·` trail behind it.
- The **first table column (`◆`)** shows each session's marker+color, so you can map rows to dots at a
  glance (`·` = no live dot / afterglow expired).
- When a session goes inactive, its dot **turns dim** (same glyph, muted color) and stays for **15 seconds
  of afterglow**, then disappears.
- Toggle the panel with `p`.

## Install

```bash
npm i -g tktop
tktop
```

Requires [Bun](https://bun.sh) ≥ 1.3.14 on the PATH (the launcher checks and tells you how to install it).

**Python / pip users:** [`pip install tktop-tui`](https://pypi.org/project/tktop-tui/) also installs the same `tktop` command — a thin Python wrapper that stages the bundled TUI into `~/.local/share/tktop/`, fetches its JS deps once via `bun install`, and execs it under Bun (network needed on first run only).

Or run straight from a checkout:

```bash
cd ~/tktop
bun run src/index.ts          # the TUI
bun run src/dump.ts           # headless one-shot table (no TUI needed)
```

Or install the repo shim once:

```bash
mkdir -p ~/.local/bin && ln -sf ~/tktop/bin/tktop ~/.local/bin/tktop
tktop
```

## Keys & mouse

| Input | Action |
|---|---|
| **click column header** | sort by that column (▼ desc / ▲ asc · click again to reverse; sortable: harness, model, session, dir, in, out, cache-r, rsn, cost, tok/min, age) |
| **click row** | move the selection cursor there |
| **mouse wheel** | scroll the table (cursor paging) |
| `1` `2` `3` `4` | quick sort: burn rate / recency / total tokens / cost |
| `/` | filter (substring over harness · session · model · dir · id) — `enter` confirm, `esc` cancel |
| `g` | group by: none → harness → model (with subtotal separator rows) |
| `a` | toggle archived sessions |
| `j` `k` `↑` `↓` / `PgUp` `PgDn` / `Home` `End` | navigate |
| `p` | toggle live scatterplot |
| `r` | force refresh now |
| `?` | help overlay |
| `q` | quit (Ctrl+C works too) |

CLI flags: `--interval <ms>` · `--filter <s>` · `--sort <key>` (any clickable column: burn, recent, tokens, cost, in, out, cacheR, rsn, age, harness, model, title, dir) · `--all` (show archived).

## Supported harnesses

| Harness | Source | Mode |
|---|---|---|
| **OpenCode** | `~/.local/share/opencode/opencode.db` (`session_v2`, read-only) | cumulative counters |
| **Claude Code** | `~/.claude/projects/**.jsonl` (auto-detected) | additive per-message usage |
| **Codex CLI** | `~/.codex/sessions/**.jsonl` (auto-detected) | latest cumulative `token_count` |
| **Anything** | generic JSONL via `~/.config/tktop/adapters.json` | additive or latest |

Zero configuration for the built-ins — an adapter activates when its data directory exists.

### Adding a harness with the generic JSONL adapter

Create `~/.config/tktop/adapters.json`:

```jsonc
{
  "sources": [
    {
      "harness": "myagent",
      "glob": "~/.myagent/sessions/*.jsonl",
      "sessionId": "session_id",
      "model": "model",
      "title": "prompt",
      "directory": "cwd",
      "timeUpdated": "timestamp",
      "usage": "usage",
      "tokens": { "input": "input_tokens", "output": "output_tokens", "reasoning": "reasoning_tokens", "cacheRead": "cache_read_input_tokens" },
      "cost": "cost",
      "mode": "additive"
    }
  ]
}
```

All paths are dotted paths into each JSON line. `mode`: `"additive"` sums per-line values (append-only logs),
`"latest"` takes the last seen value (cumulative counters). Restarting tktop re-reads additive files once —
rotating logs can overcount once per launch; avoid `mode: "additive"` with rotation if exact cost matters.

## Notes on accuracy

- **Burn rate** (TOK/MIN + sparkline) is derived live from counter deltas between polls (EMA-smoothed). It is
  accurate while tktop runs and resets on restart. Sessions show "-" until their harness records new usage —
  OpenCode, for example, persists usage when an assistant message/part completes, not per token.
- **Cost** is whatever the harness recorded (OpenCode's own accounting; Claude's `costUSD`). Missing → `-`.
- Cache-write is shown in the totals line; cache-read per session in the CACHE-R column.

## Development

```bash
bun run typecheck   # bun check (no type errors)
bun run dump        # headless table (data-layer smoke test)
```

Architecture and decisions: [`docs/`](docs/) — see `GOAL.md`, `ADR-001..003`, `RESOLUTION-PLAN.md`.

## Future ideas (ROADMAP Phase 5)

- Session drill-down (per-message, per-token breakdowns from `session_part`)
- Budget alerts: notify when rate/cost crosses a threshold
- `@opentui/ssh` server mode for remote watching
- `bun build --compile` standalone binary
