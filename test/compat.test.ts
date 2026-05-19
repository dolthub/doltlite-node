/**
 * Verifies that @dolthub/doltlite is a drop-in replacement for node:sqlite.
 * Each test mirrors expected node:sqlite behaviour so you can run an identical
 * suite against `node:sqlite` to confirm parity.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { addonAvailable } from "./helpers"
import type { DatabaseSync } from "../index"

if (!addonAvailable()) process.exit(0)

const { DatabaseSync } = require("../index") as typeof import("../index")

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(":memory:")
})
afterEach(() => {
  db.close()
})

// ── API surface ───────────────────────────────────────────────────────────────

describe("node:sqlite API surface", () => {
  test("DatabaseSync exposes the expected methods", () => {
    expect(typeof db.exec).toBe("function")
    expect(typeof db.prepare).toBe("function")
    expect(typeof db.close).toBe("function")
    expect(typeof db.open).toBe("function")
    expect(typeof db.location).toBe("function")
    expect(typeof db.createFunction).toBe("function")
  })

  test("DatabaseSync exposes the expected properties", () => {
    expect(typeof db.isOpen).toBe("boolean")
    expect(typeof db.inTransaction).toBe("boolean")
  })

  test("StatementSync exposes the expected methods", () => {
    const stmt = db.prepare("SELECT 1 AS n")
    expect(typeof stmt.run).toBe("function")
    expect(typeof stmt.get).toBe("function")
    expect(typeof stmt.all).toBe("function")
    expect(typeof stmt.iterate).toBe("function")
    expect(typeof stmt.columns).toBe("function")
    expect(typeof stmt.setReturnArrays).toBe("function")
    expect(typeof stmt.setReadBigInts).toBe("function")
    expect(typeof stmt.setAllowBareNamedParameters).toBe("function")
    expect(typeof stmt.setAllowUnknownNamedParameters).toBe("function")
  })

  test("StatementSync exposes sourceSQL and expandedSQL", () => {
    const stmt = db.prepare("SELECT 1 AS n")
    expect(typeof stmt.sourceSQL).toBe("string")
    expect(typeof stmt.expandedSQL).toBe("string")
  })
})

// ── Behaviour contract ────────────────────────────────────────────────────────

describe("node:sqlite behaviour contract", () => {
  test("exec() returns undefined (not the db)", () => {
    expect(db.exec("CREATE TABLE t (x INT)")).toBeUndefined()
  })

  test("prepare() returns a reusable statement", () => {
    db.exec("CREATE TABLE t (x INT)")
    const stmt = db.prepare("INSERT INTO t VALUES (?)")
    const r1 = stmt.run(1)
    const r2 = stmt.run(2)
    expect(r1.changes).toBe(1)
    expect(r2.changes).toBe(1)
  })

  test("get() returns undefined (not null) for no results", () => {
    db.exec("CREATE TABLE t (x INT)")
    const row = db.prepare("SELECT x FROM t WHERE x = 0").get()
    expect(row).toBeUndefined()
  })

  test("all() always returns an array, even for non-SELECT statements", () => {
    db.exec("CREATE TABLE t (x INT)")
    const rows = db.prepare("INSERT INTO t VALUES (1)").all()
    expect(Array.isArray(rows)).toBe(true)
  })

  test("run() result has integer changes property", () => {
    db.exec("CREATE TABLE t (x INT)")
    const result = db.prepare("INSERT INTO t VALUES (1)").run()
    expect(Number.isInteger(result.changes)).toBe(true)
  })

  test("run() result has numeric lastInsertRowid property", () => {
    db.exec("CREATE TABLE t (x INT)")
    const result = db.prepare("INSERT INTO t VALUES (1)").run()
    expect(typeof result.lastInsertRowid).toBe("number")
  })

  test("columns() shape matches node:sqlite spec", () => {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
    const cols = db.prepare("SELECT id, name FROM t").columns()
    expect(cols.length).toBe(2)
    for (const col of cols) {
      expect(col).toHaveProperty("name")
      expect(col).toHaveProperty("column")
      expect(col).toHaveProperty("table")
      expect(col).toHaveProperty("database")
      expect(col).toHaveProperty("type")
    }
  })

  test("foreign keys are enforced by default", () => {
    db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
    db.exec("CREATE TABLE child (pid INTEGER REFERENCES parent(id))")
    expect(() => db.exec("INSERT INTO child VALUES (999)")).toThrow()
  })

  test("named parameters: $name syntax", () => {
    db.exec("CREATE TABLE t (x INT)")
    db.prepare("INSERT INTO t VALUES ($x)").run({ $x: 7 })
    const row = db.prepare("SELECT x FROM t").get() as any
    expect(row.x).toBe(7)
  })

  test("named parameters: :name syntax", () => {
    db.exec("CREATE TABLE t (x INT)")
    db.prepare("INSERT INTO t VALUES (:x)").run({ ":x": 8 })
    const row = db.prepare("SELECT x FROM t").get() as any
    expect(row.x).toBe(8)
  })

  test("named parameters: @name syntax", () => {
    db.exec("CREATE TABLE t (x INT)")
    db.prepare("INSERT INTO t VALUES (@x)").run({ "@x": 9 })
    const row = db.prepare("SELECT x FROM t").get() as any
    expect(row.x).toBe(9)
  })

  test("unknown named parameters throw by default", () => {
    const stmt = db.prepare("SELECT $x AS x")
    expect(() => stmt.get({ $x: 1, y: 2 })).toThrow("Unknown named parameter")
  })

  test("setAllowUnknownNamedParameters ignores extra keys", () => {
    const stmt = db.prepare("SELECT $x AS x")
    expect(stmt.setAllowUnknownNamedParameters(true)).toBeUndefined()
    const row = stmt.get({ $x: 1, y: 2 }) as any
    expect(row.x).toBe(1)
  })

  test("setAllowBareNamedParameters controls bare named keys", () => {
    const stmt = db.prepare("SELECT $x AS x")
    expect(stmt.setAllowBareNamedParameters(false)).toBeUndefined()
    expect(() => stmt.get({ x: 1 })).toThrow("Unknown named parameter")
    stmt.setAllowBareNamedParameters(true)
    const row = stmt.get({ x: 2 }) as any
    expect(row.x).toBe(2)
  })

  test("setReturnArrays makes get(), all(), and iterate() return arrays", () => {
    db.exec("CREATE TABLE t (id INT, name TEXT)")
    db.exec("INSERT INTO t VALUES (1, 'a'), (2, 'b')")
    const stmt = db.prepare("SELECT id, name FROM t ORDER BY id")
    expect(stmt.setReturnArrays(true)).toBeUndefined()
    expect(stmt.get()).toEqual([1, "a"])
    expect(stmt.all()).toEqual([[1, "a"], [2, "b"]])
    expect(Array.from(stmt.iterate())).toEqual([[1, "a"], [2, "b"]])
    stmt.setReturnArrays(false)
    expect(stmt.get()).toEqual({ id: 1, name: "a" })
  })

  test("setReadBigInts makes integer columns return BigInt values", () => {
    const stmt = db.prepare("SELECT 42 AS n")
    expect(stmt.setReadBigInts(true)).toBeUndefined()
    const row = stmt.get() as any
    expect(row.n).toBe(42n)
    stmt.setReturnArrays(true)
    expect(stmt.get()).toEqual([42n])
    stmt.setReadBigInts(false)
    expect(stmt.get()).toEqual([42])
  })

  test("transaction isolation: rolled-back inserts are not visible", () => {
    db.exec("CREATE TABLE t (x INT)")
    db.exec("BEGIN")
    db.exec("INSERT INTO t VALUES (1)")
    db.exec("ROLLBACK")
    const rows = db.prepare("SELECT * FROM t").all()
    expect(rows).toHaveLength(0)
  })

  test("iterate() is a valid iterable (Symbol.iterator)", () => {
    db.exec("CREATE TABLE t (x INT)")
    db.exec("INSERT INTO t VALUES (1)")
    const iter = db.prepare("SELECT x FROM t").iterate()
    expect(iter[Symbol.iterator]()).toBe(iter)
  })

  test("BLOB round-trip via Buffer", () => {
    db.exec("CREATE TABLE t (b BLOB)")
    const original = Buffer.from([1, 2, 3, 4])
    db.prepare("INSERT INTO t VALUES (?)").run(original)
    const row = db.prepare("SELECT b FROM t").get() as any
    expect(Buffer.from(row.b)).toEqual(original)
  })

  test("integer boundary: stores and retrieves MAX_SAFE_INTEGER", () => {
    db.exec("CREATE TABLE t (n INTEGER)")
    db.prepare("INSERT INTO t VALUES (?)").run(Number.MAX_SAFE_INTEGER)
    const row = db.prepare("SELECT n FROM t").get() as any
    expect(row.n).toBe(Number.MAX_SAFE_INTEGER)
  })

  test("NULL is returned as JS null (not undefined)", () => {
    db.exec("CREATE TABLE t (x TEXT)")
    db.exec("INSERT INTO t VALUES (NULL)")
    const row = db.prepare("SELECT x FROM t").get() as any
    expect(row.x).toBeNull()
  })

  test("multiple statements via exec() are executed atomically-ish", () => {
    db.exec(`
      CREATE TABLE t (x INT);
      INSERT INTO t VALUES (10);
      INSERT INTO t VALUES (20);
    `)
    const rows = db.prepare("SELECT x FROM t ORDER BY x").all()
    expect(rows).toHaveLength(2)
  })
})

// ── Error contract ────────────────────────────────────────────────────────────

describe("error handling", () => {
  test("exec() on closed db throws", () => {
    const closed = new DatabaseSync(":memory:")
    closed.close()
    expect(() => closed.exec("SELECT 1")).toThrow()
  })

  test("prepare() on closed db throws", () => {
    const closed = new DatabaseSync(":memory:")
    closed.close()
    expect(() => closed.prepare("SELECT 1")).toThrow()
  })

  test("syntax error in exec() throws", () => {
    expect(() => db.exec("SELEC * FORM t")).toThrow()
  })

  test("syntax error in prepare() throws", () => {
    expect(() => db.prepare("SELEC * FORM t")).toThrow()
  })

  test("UNIQUE constraint violation throws", () => {
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    db.exec("INSERT INTO t VALUES (1)")
    expect(() => db.exec("INSERT INTO t VALUES (1)")).toThrow()
  })

  test("NOT NULL constraint violation throws", () => {
    db.exec("CREATE TABLE t (x TEXT NOT NULL)")
    expect(() => db.exec("INSERT INTO t VALUES (NULL)")).toThrow()
  })
})
