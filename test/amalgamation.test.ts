import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

const sourcePath = join(import.meta.dir, "..", "amalgamation", ".source", "sqlite3.c")
const outputPath = join(import.meta.dir, "..", "amalgamation", "doltlite.c")

describe("released amalgamation preparation", () => {
  test("preserves the core SEH pager shim without appending a duplicate", () => {
    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(outputPath)).toBe(true)

    const source = readFileSync(sourcePath, "utf8")
    const output = readFileSync(outputPath, "utf8")
    const definition = /^(?:SQLITE_PRIVATE )?int sqlite3PagerWalSystemErrno\(Pager \*pPager\)\{/gm

    expect(output.match(definition)?.length ?? 0).toBe(source.match(definition)?.length ?? 0)
  })

  test("selects Winsock 2 before the first windows.h include", () => {
    const output = readFileSync(outputPath, "utf8")
    const winsock = output.search(/^# *include <winsock2\.h>/m)
    const windows = output.search(/^# *include [<"]windows\.h[>"]/m)

    expect(winsock).toBeGreaterThanOrEqual(0)
    expect(windows).toBeGreaterThanOrEqual(0)
    expect(winsock).toBeLessThan(windows)
  })

  test("uses an unmodified fixed release amalgamation", () => {
    const source = readFileSync(sourcePath, "utf8")
    const output = readFileSync(outputPath, "utf8")

    if (source.includes("DOLTLITE_AMALGAMATION_WINSOCK2_EARLY")) {
      expect(output).toBe(source)
    } else {
      expect(output).toContain("DOLTLITE_NODE_WINSOCK2_EARLY_FALLBACK")
    }
  })
})
