# Changelog

All notable changes to **tktop**. Format: [Keep a Changelog](https://keepachangelog.com/); versioning: SemVer-ish per feature release.

## [0.4.0] — 2026-11-02

### Added
- **Session drill-down**: `Enter` on any row opens its per-message timeline (roles,
  models, summaries, per-message tokens/cost); headless via `tktop-dump --drill `.
  OpenCode reads `session_message` (+ optional `session_part`), degrades gracefully on
  older/harnesses without message traces.
- **Budget alerts**: `~/.config/tktop/config.json` thresholds
  (`burnTokPerMin`, `sessionCost`, `sessionTokens`); live bell + status-line banner;
  pure evaluation, unit-tested.
- **`@opentui/ssh` remote watching**: `tktop --serve [port]` exposes the live TUI to
  `ssh -p <port> localhost`; every client has independent cursor/sort/filter state.
- **Standalone binary**: `npm run compile` → `dist/tktop` (~130 MB, runs with no Bun
  install on the target machine).
- **CI publish**: tag-triggered `.github/workflows/publish.yml` with an `NPM_TOKEN`
  presence gate (skips with a notice instead of red-X until the secret is added).

## [0.3.4] — 2026-11-02

### Added
- **`tktop-dump`** — headless one-shot table as a proper command (ships in npm's
  `bin`): `tktop-dump [--filter <s>] [--sort <key>] [--all]`. Same launcher discipline
  as `tktop` (Bun check + friendly hint).
- **`CHANGELOG.md`** — full release history, from now on included in the npm tarball.

### Changed
- README rewritten: badges, real captured hero frame (tree view), feature tour,
  install troubleshooting (EACCES / EBADENGINE), docs index, roadmap.
- Repository URLs use https (browsable from registry pages).

## [0.3.3] — 2026-11-01

### Added
- **Tree view** (`t` key): htop-style nesting of subagent sessions under their parent
  session, with `├─` / `└─` branch glyphs and indentation.
  - OpenCode adapter reads `parent_id` (column-presence guarded for older DB schemas).
  - Store builds a DFS display list: active sort applies at every tree level, children
    of filtered-out parents are promoted to roots, parent cycles are broken safely
    (no hangs, no duplicated rows).
  - Verified live: subagents "Sweep tokflow UI/store for bugs" and "Test tokflow JSONL
    adapters" nested under their real parent session in production data.

### Changed
- Help overlay, README, and RESOLUTION-PLAN updated for tree view.

## [0.3.2] — 2026-10-31

### Fixed
- `engines` field now requires `bun >= 1.3.14`, matching `@opentui/core`'s real
  requirement (previously implied Node compatibility that doesn't exist).

## [0.3.1] — 2026-10-31

### Added
- **PyPI distribution**: `pip install tktop-tui` installs the same `tktop` command via
  a thin Python wrapper — stages the bundled TUI into `~/.local/share/tktop/<version>/`,
  runs `bun install --production` once on first launch, then execs it under Bun.
  Read-only site-packages are never touched.

## [0.3.0] — 2026-10-31

### Added
- **Clickable TUI (mouse support)**:
  - Click column headers to sort (▼ desc / ▲ asc toggle) across 13 sortable columns.
  - Click rows to move the selection cursor.
  - Mouse wheel scrolls the table with cursor paging.

## [0.2.0] — 2026-10-30

### Added
- Live log-scale scatterplot above the table: x = tokens(in+out), y = tok/min;
  8 markers (`● ★ ✖ ◆ ▲ ✚ ■ ✦`) × 8 colors assigned deterministically per session;
  `·` trails; 15s afterglow for freshly idle sessions. Legend column in the table maps
  rows to dots (`p` toggles the panel).

## [0.1.0] — 2026-10-30

### Added
- Initial MVP: htop-style table with header totals, EMA burn rates + sparklines,
  quick sorts (`1`-`4`), live substring filter (`/`), group-by with subtotals (`g`),
  archived toggle (`a`), help overlay (`?`).
- Adapters: OpenCode (SQLite, read-only), Claude Code (JSONL, additive), Codex CLI
  (JSONL, latest cumulative), generic JSONL via `~/.config/tktop/adapters.json`.
- Headless one-shot mode (`tktop-dump` / `src/dump.ts`).
- npm package `tktop`; MIT license; ADR-001..003 architecture docs.

[Unreleased]: https://github.com/AlexKay28/tktop/compare/v0.3.4...HEAD
[0.3.4]: https://github.com/AlexKay28/tktop/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/AlexKay28/tktop/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/AlexKay28/tktop/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/AlexKay28/tktop/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/AlexKay28/tktop/compare/0.2.0...v0.3.0
