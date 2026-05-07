import { tmpdir } from "os"
import { join } from "path"
import { mkdirSync, rmSync, existsSync, realpathSync } from "fs"
import { randomBytes } from "crypto"

/**
 * Creates a unique temporary directory for a test database.
 * Returns the db path and a cleanup function.
 *
 * realpathSync resolves symlinks (e.g. /tmp → /private/tmp on macOS) so that
 * the path we store matches what sqlite3_db_filename returns.
 */
export function tmpDb(prefix = "doltlite-test"): { path: string; cleanup: () => void } {
  const dir = join(tmpdir(), `${prefix}-${randomBytes(6).toString("hex")}`)
  mkdirSync(dir, { recursive: true })
  const realDir = realpathSync(dir)
  const path = join(realDir, "test.db")
  return {
    path,
    cleanup() {
      try { rmSync(realDir, { recursive: true, force: true }) } catch {}
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
