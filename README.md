<div align="center">

# tktop

**htop — but for AI tokens.** 🔥

A live terminal dashboard that shows, in real time, how many tokens your AI coding
agents are burning across every harness on your machine — OpenCode, Claude Code,
Codex, and anything that writes JSONL.

[![npm](https://img.shields.io/npm/v/tktop?color=cb3837&label=npm&logo=npm)](https://www.npmjs.com/package/tktop)
[![PyPI](https://img.shields.io/pypi/v/tktop-tui?color=3776ab&label=pip&logo=pypi&logoColor=white)](https://pypi.org/project/tktop-tui/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun)](https://bun.sh)
[![TUI: OpenTUI](https://img.shields.io/badge/TUI-OpenTUI-6f42c1)](https://opentui.com)

**npm i -g tktop** · **pip install tktop-tui**

</div>

---

```
  tktop  AI token consumption monitor · runtime: opencode · 12:02:16
  sessions 3 (1 active) · in 438.1K out 229.0K cache-r 40.13M rsn 0 w 0 cost - burn - tok/min
┌─ scatter · x: tokens(in+out, log) · y: tok/min · 2 dots ─────────────────────────────────────────┐
│ y: 0…100 tok/min                                                                                 │
│                                                                                                  │
│                                                                                                  │
│                                     ✚                                   ★                        │
│100K                                            1M                                              10│
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
 ◆  HARNESS    MODEL                SESSION                   IN       OUT    COST  TOK/MIN ▼   AGE
 ✚  opencode   eliza/glm-5-3        TOKFLOW               383.3K    186.9K       -          -   14s
 ·  opencode   eliza/glm-5-3        ├─ Sweep tokflow …     43.8K     35.8K       -          -   17h
 ·  opencode   eliza/glm-5-3        └─ Test tokflow J…     11.0K      6.3K       -          -   18h

  showing 3 sessions matching "/tokflow"
  sort: 1 burn · 2 recent · 3 tokens · 4 cost  ·  g group: none  ·  a archived:off  ·  / filter · p
```

*(real capture — the two nested sessions are subagents spawned by that very parent session)*

## Why tktop?

You run OpenCode, Claude Code, Codex, and half a dozen agents in parallel. They all
eat tokens, and none of them answer the simple question: **what's burning right now,
how fast, and who's responsible?**

tktop answers it at a glance — the way `htop` does for CPU and `nvtop` does for GPUs:

- 🔴 **Live** — the TUI polls (default every 2s) and sees every session's burn rate
  change in real time.
- 🧵 **Tree view** — press `t` and subagent sessions nest under their parent with
  htop-style `├─` / `└─` glyphs.
- 📈 **Scatterplot** — a live plot above the table: x = tokens consumed (log scale),
  y = tokens/min; every session is a distinct colored marker whose trail you can
  follow.
- 🖱️ **Clickable** — sort by any column by clicking its header, select rows, scroll
  with the wheel.
- 🔭 **Panopticon** — `htop`/`nvtop` class: total in/out at the top, filter (`/` /
  live substring typing), group-by with subtotals, sparkline history per session.
- 🛰️ **Multi-harness** — OpenCode, Claude Code, Codex CLI and *any* JSONL writer,
  zero configuration: adapters auto-activate when a data directory exists.
- 🕶️ **Read-only, zero-risk** — tktop never writes, talks to, or control harnesses. It
  only reads the traces they already leave on disk.
- ⚡ **Also headless** — `tktop-dump` prints the table once for scripts, logs, CI heat-maps.

## Install

```bash
npm i -g tktop     # all platforms
tktop
```

Or from Python:

```bash
pip install tktop-tui
tktop
```

Both install the same `tktop` command. The `pip` flavor stages the TUI into
`~/.local/share/tktop/` and launches it with Bun — no path conflicts either way.

**Requirements:** [`Bun` ≥ 1.3.14](https://bun.sh) on the `PATH`. If missing, tktop
prints the one-line fix and exits — first run of the pip version may also fetch JS
dependencies once.

<details>
<summary><b>Install tips</b> (permissions, Node warnings, from source)</summary>

- **warning EACCES ... /usr/lib/node_modules ?** — system npm needs sudo. The npm-recommended
  fix is a user prefix —
     
  ```bash
  mkdir ~/.npm-global
  npm config set prefix ~/.npm-global
  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
  source ~/.bashrc && npm i -g tktop
  ```
- **EBADENGINE warnings about node >= 26 ?** — cosmetic; tktop runs under Bun, not Node.
  npm just engine-checks against the Node it was invoked with.
- **From source:** `bun run src/index.ts`; repo shim: `ln -sf ~/tktop/bin/tktop ~/.local/bin/`.
- **Headless:** `tktop-dump` (or `bun run src/dump.ts`) prints one table and exits.
- **CLI flags:** `--interval <ms>` · `--filter <s>` · `--sort <key>` (burn, recent, tokens,
  cost, in, out, cacheR, rsn, age, harness, model, title, dir) · `--all` (include archived).
</details>

## Keys & mouse

| Input | Action |
|---|---|
| **click column header** | sort by that column — ▼ desc / ▲ asc, click again to reverse |
| **click row** | move the selection cursor there |
| **mouse wheel** | scroll the table (cursor paging) |
| `1` `2` `3` `4` | quick sort: burn rate · recency · total tokens · cost |
| `/` | filter, live-typed (harness · session · model · dir · id) — `enter` confirm, `esc` cancel |
| `g` | group by: none → harness → model (subtotal rows) |
| `t` | **tree view** — nest subagent sessions under their parent 🌳 |
| `a` | show/hide archived sessions |
| `j` `k` `↑` `↓` `PgUp` `PgDn` `Home` `End` | navigate |
| `p` | toggle the live scatterplot |
| `r` | force refresh now |
| `?` | help overlay |
| `q` | quit (`Ctrl+C` works too) |

## What you see

| Where | What it means |
|---|---|
| Header banner | grand totals: input, output, reasoning, cache read/write, cost, live burn |
| Scatter plot | every active session is a colored marker · x = `(bins+out)` tokens, log scale · y = tok/min · 15s afterglow when a session goes idle |
| Marker column `◆` | the same marker+color as the dot in the plot, so rows↔dots map at a glance (`·` = no live dot) |
| `TOK/MIN` + sparkline | live burn rate (EMA) and its recent history — `█▆▄▂▂▁▁` falling? generation finished |
| `CACHE-R` / `RSN` | cache-read and reasoning tokens — hidden costs of agent workloads |
| `AGE` | seconds/minutes since last activity — spot zombie or idle sessions |

## Supported harnesses

| Harness | Source | Mode |
|---|---|---|
| **[OpenCode](https://github.com/sst/opencode)** | `~/.local/share/opencode/opencode.db` (`session_v2`, read-only) | cumulative counters |
| **[Claude Code](https://claude.com/claude-code)** | `~/.claude/projects/**.jsonl` (auto-detected) | additive per-message usage |
| **[Codex CLI](https://github.com/openai/codex)** | `~/.codex/sessions/**.jsonl` (auto-detected) | latest cumulative `token_count` |
| **Anything** | generic JSONL via `~/.config/tktop/adapters.json` | additive or latest |

Zero configuration for the three built-ins. The generic JSONL adapter adds any tool
you use in a few lines:

```jsonc
// ~/.config/tktop/adapters.json
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
      "tokens": {
        "input": "input_tokens",
        "output": "output_tokens",
        "reasoning": "reasoning_tokens",
        "cacheRead": "cache_read_input_tokens"
      },
      "cost": "cost",
      "mode": "additive"   // sum per-line values; use "latest" for cumulative counters
    }
  ]
}
```

All fields are dotted paths into each JSON line.

## How accurate is it?

- **Burn rate** (`TOK/MIN` + sparkline) is derived live from counter deltas between
  polls and EMA-smoothed — accurate while tktop runs; restarts re-derive from scratch.
- **Cost** is whatever the harness records itself (OpenCode accounting, Claude's
  `costUSD`). Missing → `-`.
- Sessions show `-` until their harness records new usage (OpenCode persists usage on
  message completion, not per token).
- Cache-write is shown in totals; cache-read per session in its column.

## Docs / Architecture

| Doc | What |
|---|---|
| [`docs/GOAL.md`](docs/GOAL.md) | Goals, scope, and explicit non-goals |
| [`docs/ADR-001-architecture.md`](docs/ADR-001-architecture.md) | Adapters → Store → UI projection, why it's layered |
| [`docs/ADR-002-tooling-opentui.md`](docs/ADR-002-tooling-opentui.md) | Why Bun + OpenTUI over Node/ncurses |
| [`docs/ADR-003-adapters.md`](docs/ADR-003-adapters.md) | Adapter data contract & failure discipline |
| [`docs/RESOLUTION-PLAN.md`](docs/RESOLUTION-PLAN.md) | Shipped phases, verification evidence, roadmap |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

## Development

```bash
git clone https://github.com/AlexKay28/tktop && cd tktop
bun install           # once
bun run src/index.ts  # the TUI
bun run dump          # headless table, data-layer smoke test
bun run typecheck     # bun check
```

Layered so the data and UI never entangle: adapters (`poll() → SessionInfo[]`,
never throws) → Store (rates, sorting, grouping, tree) → UI renderables. Adding a
harness means writing one adapter — see [`src/adapters/`](src/adapters/) and the
generic-JSONL config above as a template.

## Roadmap

- [x] Live htop table, sparklines, EMA burn rates
- [x] Log-scale scatterplot with marker legend
- [x] Mouse: click-to-sort, row select, wheel scroll
- [x] Tree view for subagent sessions
- [x] npm + PyPI distribution
- [ ] Session drill-down (per-message breakdowns)
- [ ] Budget alerts (rate/cost thresholds)
- [ ] `@opentui/ssh` remote watching
- [ ] Standalone compiled binary

Ideas welcome — please [open an issue](https://github.com/AlexKay28/tktop/issues/new).

## License

[MIT](LICENSE) © AlexKay28

<div align="center">

*If tktop saves you from a runaway agent — leave a ⭐.*

</div>
