import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { addonAvailable, tmpDb } from "./helpers"
import type { DatabaseSync } from "../index"

if (!addonAvailable()) {
  console.warn("Skipping tests: native addon not built. Run `npm install` first.")
  process.exit(0)
}

const { DatabaseSync } = require("../index") as typeof import("../index")

// ── Constructor & open/close ─────────────────────────────────────────────────

describe("DatabaseSync constructor", () => {
  test("opens an in-memory database", () => {
    const db: DatabaseSync = new DatabaseSync(":memory:")
    expect(db.isOpen).toBe(true)
    db.close()
  })

  test("opens a file-based database", () => {
    const { path, cleanup } = tmpDb()
    try {
      const db: DatabaseSync = new DatabaseSync(path)
      expect(db.isOpen).toBe(true)
      expect(db.location()).toBe(path)
      db.close()
    } finally { cleanup() }
  })

  test("respects readOnly option", () => {
    const { path, cleanup } = tmpDb()
    try {
      // Create and populate the db first
      const rw: DatabaseSync = new DatabaseSync(path)
      rw.exec("CREATE TABLE t (x INTEGER)")
      rw.close()
      // Reopen read-only
      const ro: DatabaseSync = new DatabaseSync(path, { readOnly: true })
      expect(ro.isOpen).toBe(true)
      expect(() => ro.exec("INSERT INTO t VALUES (1)")).toThrow()
      ro.close()
    } finally { cleanup() }
  })

  test("respects open:false option (deferred open)", () => {
    const db: DatabaseSync = new DatabaseSync(":memory:", { open: false })
    expect(db.isOpen).toBe(false)
  })

  test("throws for a non-string path", () => {
    expect(() => new (DatabaseSync as any)(42)).toThrow()
  })
})

describe("DatabaseSync.close / isOpen", () => {
  test("isOpen is false after close()", () => {
    const db: DatabaseSync = new DatabaseSync(":memory:")
    db.close()
    expect(db.isOpen).toBe(false)
  })

  test("close() is idempotent", () => {
    const db: DatabaseSync = new DatabaseSync(":memory:")
    db.close()
    expect(() => db.close()).not.toThrow()
  })

  test("exec() throws when database is closed", () => {
    const db: DatabaseSync = new DatabaseSync(":memory:")
    db.close()
    expect(() => db.exec("SELECT 1")).toThrow()
  })

  test("prepare() throws when database is closed", () => {
    const db: DatabaseSync = new DatabaseSync(":memory:")
    db.close()
    expect(() => db.prepare("SELECT 1")).toThrow()
  })
})

// ── location() ───────────────────────────────────────────────────────────────

describe("DatabaseSync.location()", () => {
  test("returns null for :memory:", () => {
    const db: DatabaseSync = new DatabaseSync(":memory:")
    expect(db.location()).toBeNull()
    db.close()
  })

  test("returns the file path for file databases", () => {
    const { path, cleanup } = tmpDb()
    try {
      const db: DatabaseSync = new DatabaseSync(path)
      expect(db.location()).toBe(path)
      db.close()
    } finally { cleanup() }
  })
})

// ── exec() ───────────────────────────────────────────────────────────────────

describe("DatabaseSync.exec()", () => {
  let db: DatabaseSync

  beforeEach(() => { db = new DatabaseSync(":memory:") })
  afterEach(() => { db.close() })

  test("executes DDL without error", () => {
    expect(() => db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")).not.toThrow()
  })

  test("executes multiple statements in one call", () => {
    db.exec(`
      CREATE TABLE a (x INTEGER);
      CREATE TABLE b (y TEXT);
      INSERT INTO a VALUES (1);
    `)
    const stmt = db.prepare("SELECT x FROM a")
    expect(stmt.get()).toEqual({ x: 1 })
  })

  test("throws on invalid SQL", () => {
    expect(() => db.exec("NOT VALID SQL")).toThrow()
  })

  test("throws on constraint violation", () => {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    db.exec("INSERT INTO t VALUES (1)")
    expect(() => db.exec("INSERT INTO t VALUES (1)")).toThrow()
  })

  test("returns undefined", () => {
    expect(db.exec("SELECT 1")).toBeUndefined()
  })
})

// ── inTransaction ─────────────────────────────────────────────────────────────

describe("DatabaseSync.inTransaction", () => {
  let db: DatabaseSync

  beforeEach(() => { db = new DatabaseSync(":memory:") })
  afterEach(() => { db.close() })

  test("false outside a transaction", () => {
    expect(db.inTransaction).toBe(false)
  })

  test("true inside BEGIN...COMMIT", () => {
    db.exec("BEGIN")
    expect(db.inTransaction).toBe(true)
    db.exec("COMMIT")
    expect(db.inTransaction).toBe(false)
  })

  test("false after ROLLBACK", () => {
    db.exec("BEGIN")
    db.exec("ROLLBACK")
    expect(db.inTransaction).toBe(false)
  })
})
