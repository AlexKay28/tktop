/**
 * tokflow entry point.
 *
 * Usage:
 *   bun run src/index.ts                 (or the `tokflow` shim)
 *   --interval <ms>   poll interval (default 2000)
 *   --once            headless dump (delegates to src/dump.ts behavior)
 *   --filter <s>      initial substring filter
 *   --sort <key>      burn | recent | tokens | cost
 *   --all             include archived sessions
 */
import { createCliRenderer } from "@opentui/core"
import { buildAdapters } from "./adapters/registry"
import { Store } from "./store"
import { App } from "./ui"

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
  if (args.includes("--all")) store.showArchived = true
  const f = str("--filter")
  if (f) store.filter = f
  const s = str("--sort")
  if (s && ["burn", "recent", "tokens", "cost"].includes(s)) store.sortKey = s as any

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
