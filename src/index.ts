/**
 * tktop entry point.
 *
 * Usage:
 *   bun run src/index.ts                 (or the `tktop` shim)
 *   --interval <ms>   poll interval (default 2000)
 *   --filter <s>      initial substring filter
 *   --sort <key>      burn | recent | tokens | cost | in | out | cacheR | rsn | age | harness | model | title | dir
 *   --all             include archived sessions
 *   --serve [port]   SSH server mode: watch tktop from another machine
 *                    (`ssh -p <port> localhost`); default port 2222
 *
 * Config (optional): ~/.config/tktop/config.json
 *   { "alerts": { "burnTokPerMin": 5000, "sessionCost": 1.0, "sessionTokens": 1000000 } }
 */
import { createCliRenderer } from "@opentui/core"
import type { SortKey } from "./types"
import { SORT_KEYS } from "./types"
import { buildAdapters } from "./adapters/registry"
import { Store } from "./store"
import { App } from "./ui"
import { loadAlertThresholds } from "./alerts"
import { serveOverSsh } from "./serve"

const args = process.argv.slice(2)
const num = (name: string, dflt: number): number => {
  const i = args.indexOf(name)
  if (i >= 0) {
    const v = Number(args[i + 1])
    if (Number.isFinite(v) && v >= 250) return v
  }
  return dflt
}
const str = (name: string): string | null => {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? null) : null
}

async function main(): Promise<void> {
  const interval = num("--interval", 2000)
  const store = new Store(buildAdapters(), interval)
  store.alertThresholds = loadAlertThresholds()
  if (args.includes("--serve")) {
    const portIdx = args.indexOf("--serve")
    const port = Number(args[portIdx + 1])
    await serveOverSsh(store, Number.isFinite(port) && port > 0 ? port : 2222)
    return
  }
  if (args.includes("--all")) store.showArchived = true
  const f = str("--filter")
  if (f) store.filter = f
  const s = str("--sort")
  if (s && (SORT_KEYS as readonly string[]).includes(s)) store.setSort(s as SortKey)

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: "#11111b",
    targetFps: 30,
  })

  const app = new App(renderer, store)

  const shutdown = () => {
    try {
      renderer.destroy()
    } catch {}
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // initial pass, then render before the loop starts so the first frame has data
  await store.tick()
  app.render()

  let running = true
  const loop = async () => {
    while (running) {
      await new Promise((r) => setTimeout(r, interval))
      await store.tick()
      app.render()
    }
  }
  void loop()
  renderer.once("destroy", () => {
    running = false
    process.exit(0)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
