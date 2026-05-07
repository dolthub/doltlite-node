import { tmpdir } from "os"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"
import { randomBytes } from "crypto"

/**
 * Creates a unique temporary directory for a test database.
 * Returns the db path and a cleanup function.
 */
export function tmpDb(prefix = "doltlite-test"): { path: string; cleanup: () => void } {
  const dir = join(tmpdir(), `${prefix}-${randomBytes(6).toString("hex")}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "test.db")
  return {
    path,
    cleanup() {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    },
  }
}

/**
 * Guards against running tests when the native addon hasn't been compiled yet.
 * Returns true if the binary is present, false otherwise.
 */
export function addonAvailable(): boolean {
  const platform = process.platform
  const arch = process.arch
  const prebuilt = join(__dirname, "../prebuilds", `${platform}-${arch}`, "doltlite.node")
  const compiled = join(__dirname, "../build/Release/doltlite.node")
  return existsSync(prebuilt) || existsSync(compiled)
}
