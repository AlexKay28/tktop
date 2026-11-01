# tokflow — Goal & Requirements

## Goal

**tokflow** is a single executable terminal dashboard (htop/nvtop/lazydocker class) that shows,
live, how many tokens AI model sessions on this machine are consuming — aggregated and filterable
by **harness**, **session**, and **model**.

The operator (you) runs several AI coding harnesses on one VM. tokflow answers, at a glance:

- What is burning tokens *right now* — and how fast (tokens/min)?
- Which session/model/directory is responsible?
- What has been spent in total: input, output, reasoning, cache read/write, and cost?
- What happened recently (activity age, per-session burn sparklines)?

## Scope & non-goals

### In scope

1. **Observe only.** tokflow never controls, throttles, or talks to harnesses. It is a read-only
   consumer of traces the harnesses already leave on disk.
2. **Per-harness adapters.** Each supported harness gets an adapter that converts its on-disk
   traces into a normalized `SessionInfo` snapshot.
3. **Live update.** A polling loop re-reads the traces, computes deltas of cumulative token
   counters, and derives burn rates (EMA-smoothed tokens/min) plus short sparkline history.
4. **htop-style navigation.** Sort (recent / tokens / cost / burn rate), substring filter,
   group-by (harness / model), show/hide archived sessions, help overlay.

### Out of scope (explicitly)

- **No harness control.** No pausing sessions, no budget enforcement, no feedback into harnesses.
  (Possible future work: alerting on thresholds. See ROADMAP Phase 5.)
- **No network plumbing.** tokflow runs where the data lives; remote display can come later via
  SSH (OpenTUI has an `@opentui/ssh` package) — not part of v1.
- **No perfect accounting.** Some harnesses don't persist every usage event; tokflow reports what
  the harness itself recorded, and each adapter documents its fidelity and caveats.

## Stakeholder interfaces

- Operator: keyboard-only TUI (`q` quits, everything else is safe).
- Machine: read-only file access under `$HOME` (`~/.local/share/...`, `~/.config/...`).
- Integrator: new harness = one adapter file implementing the `Adapter` interface; no core changes.
