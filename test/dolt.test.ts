/**
 * Tests for the dolt* version-control methods on DatabaseSync.
 * These require a file-based database (dolt SQL functions are not available
 * on :memory: databases because they need the dolt storage layer).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { addonAvailable, tmpDb } from "./helpers"
import type { DatabaseSync } from "../index"

if (!addonAvailable()) process.exit(0)

const { DatabaseSync } = require("../index") as typeof import("../index")

// ── Shared setup ─────────────────────────────────────────────────────────────

let db: DatabaseSync
let cleanup: () => void

beforeEach(() => {
  const tmp = tmpDb("dolt-test")
  cleanup = tmp.cleanup
  db = new DatabaseSync(tmp.path)
  db.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`)
})

afterEach(() => {
  db.close()
  cleanup()
})

// ── doltVersion() ────────────────────────────────────────────────────────────

describe("doltVersion()", () => {
  test("returns a non-empty version string", () => {
    const version = db.doltVersion()
    expect(typeof version).toBe("string")
    expect(version.length).toBeGreaterThan(0)
  })
})

// ── doltActiveBranch() ───────────────────────────────────────────────────────

describe("doltActiveBranch()", () => {
  test("returns 'main' on a fresh database", () => {
    const branch = db.doltActiveBranch()
    expect(branch).toBe("main")
  })
})

// ── doltStatus() ────────────────────────────────────────────────────────────

describe("doltStatus()", () => {
  test("returns empty array when working set is clean", () => {
    // After the first dolt_commit the working set should be clean
    db.doltCommit("initial")
    const status = db.doltStatus()
    expect(status).toBeArray()
    expect(status).toHaveLength(0)
  })

  test("shows staged tables after adding data", () => {
    db.doltCommit("create table")
    db.exec("INSERT INTO items VALUES (1, 'hello')")
    db.doltAdd("items")
    const status = db.doltStatus()
    expect(status.length).toBeGreaterThan(0)
    const itemsEntry = status.find((s: any) => s.table_name === "items")
    expect(itemsEntry).toBeDefined()
  })
})

// ── doltCommit() ─────────────────────────────────────────────────────────────

describe("doltCommit()", () => {
  test("returns a commit hash string", () => {
    const hash = db.doltCommit("first commit")
    expect(typeof hash).toBe("string")
    expect(hash.length).toBeGreaterThan(0)
  })

  test("two commits produce different hashes", () => {
    const h1 = db.doltCommit("commit one")
    db.exec("INSERT INTO items VALUES (1, 'a')")
    const h2 = db.doltCommit("commit two")
    expect(h1).not.toBe(h2)
  })

  test("commit appears in doltLog()", () => {
    db.doltCommit("my special commit")
    const log = db.doltLog()
    expect(log.length).toBeGreaterThan(0)
    const found = log.find((c: any) => c.message === "my special commit")
    expect(found).toBeDefined()
  })
})

// ── doltLog() ────────────────────────────────────────────────────────────────

describe("doltLog()", () => {
  test("returns an array of commit objects", () => {
    db.doltCommit("first")
    const log = db.doltLog()
    expect(log).toBeArray()
    expect(log.length).toBeGreaterThan(0)
  })

  test("each entry has commit_hash, committer, message, date", () => {
    db.doltCommit("structured commit")
    const log = db.doltLog()
    const entry = log[0] as any
    expect(entry).toHaveProperty("commit_hash")
    expect(entry).toHaveProperty("committer")
    expect(entry).toHaveProperty("message")
    expect(entry).toHaveProperty("date")
  })

  test("limit option restricts results", () => {
    db.doltCommit("c1")
    db.exec("INSERT INTO items VALUES (1,'x')")
    db.doltCommit("c2")
    db.exec("INSERT INTO items VALUES (2,'y')")
    db.doltCommit("c3")
    const limited = db.doltLog({ limit: 2 })
    expect(limited.length).toBeLessThanOrEqual(2)
  })

  test("log is ordered newest first", () => {
    db.doltCommit("first")
    db.exec("INSERT INTO items VALUES (1,'x')")
    db.doltCommit("second")
    const log = db.doltLog()
    expect((log[0] as any).message).toBe("second")
  })
})

// ── doltBranch() / doltBranches() / doltCheckout() ───────────────────────────

describe("doltBranch() / doltBranches() / doltCheckout()", () => {
  beforeEach(() => { db.doltCommit("initial commit") })

  test("doltBranches() includes main", () => {
    const branches = db.doltBranches()
    const names = branches.map((b: any) => b.name)
    expect(names).toContain("main")
  })

  test("doltBranch() creates a new branch", () => {
    db.doltBranch("feature")
    const branches = db.doltBranches()
    const names = branches.map((b: any) => b.name)
    expect(names).toContain("feature")
  })

  test("doltCheckout() switches to the new branch", () => {
    db.doltBranch("dev")
    db.doltCheckout("dev")
    expect(db.doltActiveBranch()).toBe("dev")
  })

  test("doltCheckout() back to main works", () => {
    db.doltBranch("dev")
    db.doltCheckout("dev")
    db.doltCheckout("main")
    expect(db.doltActiveBranch()).toBe("main")
  })

  test("creating a branch from a specific source", () => {
    db.doltBranch("from-main", "main")
    const branches = db.doltBranches()
    const names = branches.map((b: any) => b.name)
    expect(names).toContain("from-main")
  })

  test("throws on checkout of nonexistent branch", () => {
    expect(() => db.doltCheckout("does-not-exist")).toThrow()
  })
})

// ── doltAdd() ────────────────────────────────────────────────────────────────

describe("doltAdd()", () => {
  beforeEach(() => { db.doltCommit("initial") })

  test("staging a specific table reduces unstaged entries", () => {
    db.exec("INSERT INTO items VALUES (1, 'staged')")
    db.doltAdd("items")
    const status = db.doltStatus()
    const itemsEntry = status.find((s: any) => s.table_name === "items") as any
    expect(itemsEntry?.staged).toBe(1)
  })

  test("doltAdd() with no arg stages all tables", () => {
    db.exec("INSERT INTO items VALUES (1, 'all')")
    db.doltAdd()
    const status = db.doltStatus()
    const unstaged = status.filter((s: any) => s.staged === 0)
    expect(unstaged).toHaveLength(0)
  })
})

// ── doltMerge() ──────────────────────────────────────────────────────────────

describe("doltMerge()", () => {
  beforeEach(() => { db.doltCommit("initial") })

  test("fast-forward merge of a branch with new commits", () => {
    db.doltBranch("feat")
    db.doltCheckout("feat")
    db.exec("INSERT INTO items VALUES (1, 'from feat')")
    db.doltCommit("feat commit")
    db.doltCheckout("main")
    const result = db.doltMerge("feat")
    expect(result).toMatchObject({ fast_forward: expect.any(Number), conflicts: expect.any(Number) })
    expect(result.conflicts).toBe(0)
  })

  test("merged data is visible on main after merge", () => {
    db.doltBranch("data-branch")
    db.doltCheckout("data-branch")
    db.exec("INSERT INTO items VALUES (42, 'merged-value')")
    db.doltCommit("add item 42")
    db.doltCheckout("main")
    db.doltMerge("data-branch")
    const row = db.prepare("SELECT value FROM items WHERE id = 42").get() as any
    expect(row?.value).toBe("merged-value")
  })
})

// ── doltReset() ──────────────────────────────────────────────────────────────

describe("doltReset()", () => {
  test("soft reset keeps working-set changes", () => {
    db.doltCommit("initial")
    db.exec("INSERT INTO items VALUES (1, 'pending')")
    db.doltAdd("items")
    expect(() => db.doltReset()).not.toThrow()
  })

  test("hard reset discards staged and unstaged changes", () => {
    db.doltCommit("initial")
    db.exec("INSERT INTO items VALUES (1, 'discard-me')")
    db.doltReset("--hard")
    const rows = db.prepare("SELECT * FROM items").all()
    expect(rows).toHaveLength(0)
  })
})

// ── doltDiff() ───────────────────────────────────────────────────────────────

describe("doltDiff()", () => {
  test("returns row-level diff between two commits", () => {
    const h1 = db.doltCommit("before")
    db.exec("INSERT INTO items VALUES (1, 'new-row')")
    const h2 = db.doltCommit("after")
    const diff = db.doltDiff(h1, h2, "items")
    expect(diff).toBeArray()
    expect(diff.length).toBeGreaterThan(0)
    const added = diff.find((d: any) => d.diff_type === "added")
    expect(added).toBeDefined()
  })

  test("diff between identical commits returns empty array", () => {
    const h1 = db.doltCommit("same")
    const diff = db.doltDiff(h1, h1, "items")
    expect(diff).toHaveLength(0)
  })
})

// ── doltHashOf() ─────────────────────────────────────────────────────────────

describe("doltHashOf()", () => {
  test("returns a non-empty hash string for HEAD", () => {
    db.doltCommit("initial")
    const hash = db.doltHashOf()
    expect(typeof hash).toBe("string")
    expect(hash.length).toBeGreaterThan(0)
  })

  test("hash changes after a new commit", () => {
    db.doltCommit("first")
    const h1 = db.doltHashOf()
    db.exec("INSERT INTO items VALUES (1, 'x')")
    db.doltCommit("second")
    const h2 = db.doltHashOf()
    expect(h1).not.toBe(h2)
  })
})

// ── doltTag() / doltTags() ───────────────────────────────────────────────────

describe("doltTag() / doltTags()", () => {
  beforeEach(() => { db.doltCommit("initial") })

  test("doltTag() creates a tag visible in doltTags()", () => {
    db.doltTag("v1.0.0")
    const tags = db.doltTags()
    const names = tags.map((t: any) => t.tag_name)
    expect(names).toContain("v1.0.0")
  })

  test("doltTags() returns empty array when no tags exist", () => {
    const tags = db.doltTags()
    expect(tags).toBeArray()
  })

  test("tag object has expected fields", () => {
    db.doltTag("v2.0.0")
    const tags = db.doltTags()
    const tag = tags.find((t: any) => t.tag_name === "v2.0.0") as any
    expect(tag).toBeDefined()
    expect(tag).toHaveProperty("tag_hash")
    expect(tag).toHaveProperty("tagger")
  })
})

// ── doltHistoryOf() ──────────────────────────────────────────────────────────

describe("doltHistoryOf()", () => {
  test("returns history rows for a table", () => {
    db.doltCommit("c1")
    db.exec("INSERT INTO items VALUES (1, 'v1')")
    db.doltCommit("c2")
    db.exec("UPDATE items SET value = 'v2' WHERE id = 1")
    db.doltCommit("c3")
    const history = db.doltHistoryOf("items")
    expect(history).toBeArray()
    expect(history.length).toBeGreaterThanOrEqual(2)
  })

  test("each history row has a commit_hash", () => {
    db.doltCommit("initial")
    db.exec("INSERT INTO items VALUES (1, 'x')")
    db.doltCommit("add item")
    const history = db.doltHistoryOf("items")
    expect((history[0] as any)).toHaveProperty("commit_hash")
  })
})

// ── doltBlameOf() ────────────────────────────────────────────────────────────

describe("doltBlameOf()", () => {
  test("returns blame rows for a table", () => {
    db.doltCommit("initial")
    db.exec("INSERT INTO items VALUES (1, 'blamed')")
    db.doltCommit("add item")
    const blame = db.doltBlameOf("items")
    expect(blame).toBeArray()
    expect(blame.length).toBeGreaterThan(0)
  })
})

// ── doltCherryPick() ─────────────────────────────────────────────────────────

describe("doltCherryPick()", () => {
  test("cherry-picks a commit from another branch", () => {
    db.doltCommit("initial")
    db.doltBranch("source")
    db.doltCheckout("source")
    db.exec("INSERT INTO items VALUES (99, 'cherry')")
    const hash = db.doltCommit("cherry commit")
    db.doltCheckout("main")
    expect(() => db.doltCherryPick(hash)).not.toThrow()
    const row = db.prepare("SELECT value FROM items WHERE id = 99").get() as any
    expect(row?.value).toBe("cherry")
  })
})

// ── doltRevert() ─────────────────────────────────────────────────────────────

describe("doltRevert()", () => {
  test("reverts HEAD commit", () => {
    db.doltCommit("initial")
    db.exec("INSERT INTO items VALUES (1, 'added')")
    db.doltCommit("add item")
    expect(() => db.doltRevert("HEAD")).not.toThrow()
    // After revert the item should be gone
    const rows = db.prepare("SELECT * FROM items").all()
    expect(rows).toHaveLength(0)
  })
})
