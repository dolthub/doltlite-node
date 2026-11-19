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

    const winsockFixed = source.includes("DOLTLITE_AMALGAMATION_WINSOCK2_EARLY")
    const hasMergeSubtype = source.includes("DOLTLITE_MERGE_FAST_FORWARD_SUBTYPE")
    if (winsockFixed && hasMergeSubtype) expect(output).toBe(source)
    if (!winsockFixed) expect(output).toContain("DOLTLITE_NODE_WINSOCK2_EARLY_FALLBACK")
    expect(output).toContain("DOLTLITE_MERGE_FAST_FORWARD_SUBTYPE")
  })
})
