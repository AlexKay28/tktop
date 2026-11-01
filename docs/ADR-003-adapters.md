# ADR-003: Harness adapters — data sources, fidelity, and caveats

- Status: accepted
- Date: 2026-11-01

## Registry & auto-detection

`src/adapters/registry.ts` instantiates every built-in adapter, keeps those whose
`available()` is true (data directory exists), plus any sources declared by the operator in
`~/.config/tktop/adapters.json`. tktop is therefore zero-config on machines with known
harnesses and extensible for unknown ones via the generic adapter.

## 1. OpenCode (reference adapter, fully vetted on this VM)

- **Source**: SQLite at `~/.local/share/opencode/opencode.db` — table **`session_v2`**
  (falling back to legacy `session` if absent in older versions).
- **Fields**: `id, title, directory, model, agent, cost, tokens_input, tokens_output,
  tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated,
  time_archived` — cumulative per-session counters maintained by OpenCode itself. Verified on
  this VM: 770 sessions with models like `eliza/glm-5-3`, `opencode/big-pickle`, …
- **Model field is JSON**: `{"id":"glm-5-3","providerID":"eliza"}` → normalized to `provider/id`.
- **Access mode**: `new Database(path, { readonly: true })` (bun:sqlite). WAL-safe: the live
  `-wal`/`-shm` files exist beside the db while OpenCode runs; read-only connections read WAL
  snapshots without disturbing the writer.
- **Caveats**: `cost` is OpenCode's own accounting (provider rates may differ). Sessions are
  enumerable in one query (cheap; ~800 rows).

## 2. Claude Code (no `~/.claude` on this VM yet — auto-activates when installed)

- **Source**: newline-delimited JSON under `~/.claude/projects/<project>/*.jsonl`.
- **Extraction**:
  - session key: `sessionId` (fallback: file path),
  - assistant lines: `message.model`, `message.usage` →
    `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`,
  - cost: `costUSD` when present,
  - title: first user-turn text, truncated,
  - directory: `cwd`, timestamp: ISO `timestamp` → epoch ms.
- **Mode**: **additive** — usage is per-assistant-message, so counters are summed. Incremental
  tail reads (cursor on byte offset per file) avoid re-parsing large logs every poll; a partial
  trailing line (mid-write) is stashed until the poll where it completes.
- **`isSidechain: true`** lines contribute to the same session (they are real token spend).

## 3. Codex CLI (no `~/.codex` on this VM yet — auto-activates when installed)

- **Source**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
- **Extraction**:
  - `payload.type === "token_count"` → `info.total_token_usage` /
    `last_token_usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`,
    `reasoning_output_tokens`); parsed tolerantly because Codex has renamed these fields
    across versions,
  - `payload.type === "session_meta"` → `id`, `cwd`,
  - `payload.type === "turn_context"` (or sibling fields) → model,
  - session id: file stem `rollout-<id>` fallback.
- **Mode**: **latest** — `token_count` events carry *cumulative* usage, so we overwrite rather
  than sum. Re-parsing a whole file is idempotent by design.
- **Caveat**: usage events are only emitted for turns Codex reports; totals may exclude
  provider-side cache writes that Codex doesn't persist.

## 4. Generic JSONL (operator-declared sources)

Config at `~/.config/tktop/adapters.json`:

```jsonc
{
  "sources": [
    {
      "harness": "myagent",
      "glob": "/home/me/.myagent/sessions/*.jsonl",
      "sessionId": "sessionId",      // dotted paths into each JSON line
      "model": "model",
      "title": "prompt",
      "directory": "cwd",
      "timeUpdated": "timestamp",   // ISO string or epoch ms
      "usage": "usage",             // object containing the token fields
      "tokens": {                    // names inside `usage`:
        "input": "input_tokens", "output": "output_tokens",
        "reasoning": "reasoning_tokens",
        "cacheRead": "cache_read_input_tokens", "cacheWrite": "cache_creation_input_tokens"
      },
      "cost": "cost",               // optional dotted path
      "mode": "additive"             // "additive" | "latest"
    }
  ]
}
```

- **additive**: sums per line (JSONL append-only assumption); incremental tail cursors prevent
  double counting within a tktop run. Full re-read happens only on first poll or file shrink
  (rotation) — additive sources may overcount once per tktop launch with rotating files.
- **latest**: last seen value wins (for cumulative counter styles like Codex).

## Cross-cutting rules

1. Adapters never throw; errors → `lastError` + previous snapshot (store keeps last good rows).
2. Epoch ms everywhere (`Date.parse` for ISO strings); the store owns "now".
3. Burn-rate semantics identical across harnesses: delta of `(output + reasoning)` cumulative
   counters over wall-clock time.
4. Missing fields render as `-`, never as 0-with-misleading-precision.
