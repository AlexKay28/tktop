/**
 * SSH server mode (`tktop --serve [port]`): remote watching via `@opentui/ssh`.
 *
 * Every incoming SSH connection gets its own App (UI) on the shared Store, so
 * multiple operators can watch the same live data simultaneously with their
 * own cursor/sort/filter state. Observe-only discipline applies unchanged:
 * the server opens harness data read-only and never talks to harnesses.
 *
 * Connect:  ssh -p <port> localhost     (any key the SSH client presents is accepted)
 */
import { homedir } from "node:os"
import { mkdirSync, existsSync, rmSync } from "node:fs"
import type { Store } from "./store"
import type { App as AppType } from "./ui"

/**
 * ssh2 (a transitive dependency of @opentui/ssh) ships an *optional* native
 * crypto addon that hard-crashes Bun 1.4.x at load time (`uv_gettimeofday`
 * panic) before upstream's try/catch can save us. Removing the binary makes
 * ssh2 fall back to its pure-JS implementation — functionally identical for
 * tktop's read-only use, and the upstream try/catch makes this a supported
 * configuration. Tracked in Bun: https://github.com/oven-sh/bun/issues/18546
 */
function defuseSsh2NativeCrypto(): void {
  const candidates = [
    // ssh2's optional native crypto (Bun-incompatible NAPI: uv_gettimeofday)
    "../node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node",
    // ssh2's optional cpu-features probe, same Bun panic
    "../node_modules/cpu-features/build/Release/cpufeatures.node",
  ]
  let removed = false
  for (const rel of candidates) {
    try {
      const p = new URL(rel, import.meta.url).pathname
      if (existsSync(p)) {
        rmSync(p)
        removed = true
      }
    } catch {
      // never block startup over this
    }
  }
  if (removed)
    console.error(
      "tktop: removed Bun-incompatible optional ssh2 native addons (sshcrypto/cpu-features); ssh2 uses its JS fallbacks",
    )
}

export async function serveOverSsh(store: Store, port = 2222): Promise<void> {
  defuseSsh2NativeCrypto()
  const { createServer } = await import("@opentui/ssh")
  const { App } = await import("./ui")
  const keyDir = `${homedir()}/.config/tktop`
  mkdirSync(keyDir, { recursive: true })

  const apps = new Set<AppType>()

  const server = createServer({
    hostKey: { path: `${keyDir}/ssh_host_key` }, // auto-generated on first run
    auth: { publicKey: "any" }, // identity by key, no passwords — private tooling
  }).serve((session) => {
    const app = new App(session.renderer, store)
    apps.add(app)
    session.onClose(() => apps.delete(app))
  })

  const bound = await server.listen(port, "127.0.0.1")
  console.log(`tktop --serve: watching from ${bound.host}:${bound.port} (ssh -p ${bound.port} localhost)`)
  console.log("press ctrl-c to stop")

  // shared polling loop: one store tick, then every connected client re-renders
  const loop = async (): Promise<void> => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000))
      await store.tick()
      for (const app of apps) app.render()
    }
  }
  void loop()
}
