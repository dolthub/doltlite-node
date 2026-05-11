import { describe, test, expect } from "bun:test"
import { existsSync, statSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { addonAvailable } from "./helpers"

// binPath() works without the native addon — it just looks at the
// filesystem — but skipping in lockstep with the other tests keeps a
// fresh checkout (no prebuilds yet) from failing.
if (!addonAvailable()) {
  console.warn("Skipping tests: native addon not built. Run `npm install` first.")
  process.exit(0)
}

const { binPath } = require("../index") as typeof import("../index")

// Upstream dolthub/doltlite only releases CLI tools for these platforms;
// other prebuilds get the .node addon but no shell binary.
const CLI_PLATFORMS = new Set(["linux-x64", "darwin-arm64", "win32-x64"])
const key = `${process.platform}-${process.arch}`

describe("binPath", () => {
  if (!CLI_PLATFORMS.has(key)) {
    test("throws on platforms with no upstream CLI build", () => {
      expect(() => binPath()).toThrow(/no doltlite CLI binary bundled/)
    })
    return
  }

  test("returns an absolute path under prebuilds/", () => {
    const p = binPath()
    expect(p.startsWith("/") || /^[A-Z]:\\/.test(p)).toBe(true)
    expect(p).toContain(join("prebuilds", key))
  })

  test("points to an existing file", () => {
    const p = binPath()
    expect(existsSync(p)).toBe(true)
    expect(statSync(p).isFile()).toBe(true)
  })

  test("the binary runs and reports a doltlite version", () => {
    const p = binPath()
    // sqlite3-style shell: `<binary> :memory: "<sql>"` runs the SQL once and exits.
    const out = execFileSync(p, [":memory:", "SELECT dolt_version();"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim()
    expect(out.length).toBeGreaterThan(0)
    // Don't lock to an exact version — just check it looks plausibly semver.
    expect(out).toMatch(/^v?\d+\.\d+\.\d+/)
  })
})
