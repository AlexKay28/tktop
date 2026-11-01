# tktop-tui

Python launcher for **tktop** — the live htop-style TUI dashboard for AI token
consumption across coding agents (OpenCode, Claude Code, Codex, generic JSONL).

```
pip install tktop-tui
tktop
```

The wheel bundles the TypeScript TUI. On first run it stages the app into
`~/.local/share/tktop/<version>/`, runs `bun install` there (so read-only
site-packages are never touched), and execs the TUI under
[Bun](https://bun.sh) — install it first if you don't have it:

```
curl -fsSL https://bun.sh/install | bash
```

Requirements:

- Python ≥ 3.10
- Bun ≥ 1.3.14 (for the TUI runtime)
- network on the very first launch only (to fetch `@opentui/core`)

Features: per-session token/burn-rate table with mouse-clickable column
sorting, live log-scale scatterplot (colored markers + trails), grouping,
filtering, sparklines — all read-only, tktop never touches your harnesses.

GitHub: <https://github.com/AlexKay28/tktop>
