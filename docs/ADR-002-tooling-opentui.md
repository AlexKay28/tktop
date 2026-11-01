# ADR-002: Tooling — Bun + @opentui/core, plain TypeScript renderables

- Status: accepted
- Date: 2026-11-01

## Context

The operator explicitly requested **OpenTUI** as the TUI layer (the repository is cloned at
`~/opentui`, and OpenCode — the primary monitored harness — uses OpenTUI in production).
The VM's system Node is v18.19.1, too old for OpenTUI's native runtime requirements. No Bun or
other JS runtime was installed. The data layer needs SQLite access from the same process.

## Decision

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** (latest, user-local `~/.bun`) | Executes TypeScript directly, satisfies OpenTUI runtime requirements, ships built-in `bun:sqlite` (native, fast, read-only capable) — no native npm module compilation. |
| UI package | **`@opentui/core`**, imperative renderables | One dependency, no framework. React/Solid bindings would add weight with no benefit for a table-centric dashboard. Keymap package rejected: a global `keyInput` handler is enough for tktop's hotkey surface. |
| Language | **TypeScript**, strict-ish, ESM | OpenTUI ships first-class TS types; Bun runs it natively. |
| Config | **`~/.config/tktop/adapters.json`** | Lets the operator declare extra generic JSONL sources without code. Built-in adapters need zero configuration. |
| Binary story | `bin/tktop` shim → `bun run` | Simple; `bun build --compile` to a standalone executable is a later polish item (ROADMAP Phase 5). |

## OpenTUI usage notes (the API subset tktop uses)

Established from the canonical docs in `~/opentui/packages/web/src/content/docs/**`
(the OpenTUI agent skill):

1. **Renderer bootstrap**
   ```ts
   const renderer = await createCliRenderer({ exitOnCtrlC: true, backgroundColor: "#11111b" })
   ```
   Owns the terminal (alternate screen), restores it on destroy. `renderer.root` is the root
   flex node; `renderer.width/height` give the current cell geometry (SIGWINCH handled for us).

2. **Tree & layout**: `BoxRenderable` + `TextRenderable`, Yoga flexbox semantics
   (`flexDirection: "column"`, `flexGrow: 1`, `paddingX`, `width: "100%"`, `height: 1` …).
   Layout is on a grid of terminal cells; design for information density, no gaps between panels.

3. **Rich text**: one row = one `TextRenderable` whose content is a `t` tagged template with
   styled spans (`fg`, `bold`, …). Column coloring without one node per cell.

4. **Live updates**: mutating `.content` schedules a frame on OpenTUI's demand-driven schedule —
   no manual frame loop needed for a 0.5 Hz data refresh. Mouse/animation APIs unused in v1.

5. **Keyboard**: `renderer.keyInput.on("keypress", key => …)`, checking `key.name`
   (`"q"`, `"escape"`, `"return"`, `"up"`, `"down"`, `"pageup"`, `"pagedown"`) and modifiers.
   Direct listeners run *before* the focused renderable — tktop gates its hotkeys on a
   `mode` (normal / filter) so typing in the filter input never triggers actions like quit.

6. **Input**: `InputRenderable` for the `/` filter prompt (`.focus()`, `INPUT`/`ENTER` events,
   `visible` toggling to show it only in filter mode).

7. **Row pool**: rows are `TextRenderable` nodes reused across ticks
   (`visible = false` for extras; `add/remove` for growth) — avoids per-tick scene churn.

8. **Overlays**: help panel is an absolute-positioned Box (`position: "absolute"`, fixed
   `top`/`left` offsets), toggled with `?`.

## Alternatives considered

- **blessed / ink / React+Ink** — violates the explicit OpenTUI requirement; older ecosystems.
- **@opentui/react or @opentui/solid** — declarative niceties don't pay off for a single
  static-structure screen with pooled rows; they'd add a framework to learn/debug.
- **Node 18 + rebuilt native sqlite** — double fight (old runtime vs. OpenTUI native ABI,
  node-gyp for sqlite); rejected.

## Consequences

- One runtime (Bun) + one UI dependency — trivially auditable.
- Testability: the data pipeline is pure TS and runs headless (`bun run src/dump.ts` dumps
  the table to stdout) — the TUI layer can also be exercised with OpenTUI's test renderer in the future.
- Vendor lock is low: OpenTUI core renderables map 1:1 to ink-style concepts if a port is ever
  needed.
