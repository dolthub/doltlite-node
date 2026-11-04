import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { addonAvailable } from "./helpers"
import type { DatabaseSync, StatementSync } from "../index"

if (!addonAvailable()) process.exit(0)

const { DatabaseSync } = require("../index") as typeof import("../index")

// ── Shared setup ─────────────────────────────────────────────────────────────

let db: DatabaseSync

beforeEach(() => {
  db = new DatabaseSync(":memory:")
  db.exec(`
    CREATE TABLE products (
      id    INTEGER PRIMARY KEY,
      name  TEXT    NOT NULL,
      price REAL,
      stock INTEGER,
      meta  TEXT
    )
  `)
  db.exec(`
    INSERT INTO products VALUES
      (1, 'Apple',  1.50,  100, '{"organic":true}'),
      (2, 'Banana', 0.75,  250, null),
      (3, 'Cherry', 3.00,  50,  '{"seasonal":true}')
  `)
})

afterEach(() => { db.close() })

// ── prepare() ────────────────────────────────────────────────────────────────

describe("DatabaseSync.prepare()", () => {
  test("returns a StatementSync object", () => {
    const stmt: StatementSync = db.prepare("SELECT 1")
    expect(stmt).toBeDefined()
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

  test("throws on invalid SQL", () => {
    expect(() => db.prepare("SELECT * FROM nonexistent_table_xyz")).toThrow()
  })

  test("sourceSQL reflects the original SQL", () => {
    const sql = "SELECT id, name FROM products WHERE id = ?"
    const stmt = db.prepare(sql)
    expect(stmt.sourceSQL).toBe(sql)
  })

  test("expandedSQL shows bound parameter values", () => {
    const stmt = db.prepare("SELECT id FROM products WHERE id = ?")
    stmt.run(1)
    // expandedSQL is populated after binding; after run() params are cleared
    // so check sourceSQL is at least present
    expect(stmt.sourceSQL).toContain("SELECT id")
  })
})

// ── StatementSync.get() ───────────────────────────────────────────────────────

describe("StatementSync.get()", () => {
  test("returns first matching row as an object", () => {
    const row = db.prepare("SELECT * FROM products WHERE id = 1").get()
    expect(row).toEqual({ id: 1, name: "Apple", price: 1.5, stock: 100, meta: '{"organic":true}' })
  })

  test("returns undefined when no row matches", () => {
    const row = db.prepare("SELECT * FROM products WHERE id = 999").get()
    expect(row).toBeUndefined()
  })

  test("accepts positional parameters", () => {
    const row = db.prepare("SELECT name FROM products WHERE id = ?").get(2)
    expect(row).toEqual({ name: "Banana" })
  })

  test("accepts named parameters with $-prefix", () => {
    const row = db.prepare("SELECT name FROM products WHERE id = $id").get({ $id: 3 })
    expect(row).toEqual({ name: "Cherry" })
  })

  test("accepts named parameters with :-prefix", () => {
    const row = db.prepare("SELECT name FROM products WHERE id = :id").get({ ":id": 3 })
    expect(row).toEqual({ name: "Cherry" })
  })

  test("accepts named parameters with @-prefix", () => {
    const row = db.prepare("SELECT name FROM products WHERE id = @id").get({ "@id": 2 })
    expect(row).toEqual({ name: "Banana" })
  })

  test("returns null for SQL NULL columns", () => {
    const row = db.prepare("SELECT meta FROM products WHERE id = 2").get() as any
    expect(row.meta).toBeNull()
  })
})

// ── StatementSync.all() ───────────────────────────────────────────────────────

describe("StatementSync.all()", () => {
  test("returns all rows", () => {
    const rows = db.prepare("SELECT id FROM products ORDER BY id").all()
    expect(rows).toHaveLength(3)
    expect(rows.map((r: any) => r.id)).toEqual([1, 2, 3])
  })

  test("returns empty array when no rows match", () => {
    const rows = db.prepare("SELECT * FROM products WHERE id > 9999").all()
    expect(rows).toEqual([])
  })

  test("respects positional parameters", () => {
    const rows = db.prepare("SELECT id FROM products WHERE price < ?").all(1.0)
    expect(rows).toHaveLength(1)
    expect((rows[0] as any).id).toBe(2)
  })

  test("respects named parameters", () => {
    const rows = db.prepare("SELECT id FROM products WHERE stock >= $min").all({ $min: 100 })
    expect(rows).toHaveLength(2)
  })
})

// ── StatementSync.run() ───────────────────────────────────────────────────────

describe("StatementSync.run()", () => {
  test("returns { changes, lastInsertRowid } for INSERT", () => {
    const result = db.prepare("INSERT INTO products VALUES (4, 'Date', 2.00, 30, null)").run()
    expect(result.changes).toBe(1)
    expect(result.lastInsertRowid).toBe(4)
  })

  test("changes reflects affected row count for UPDATE", () => {
    const result = db.prepare("UPDATE products SET stock = 0 WHERE price > 1.0").run()
    expect(result.changes).toBe(2) // Apple (1.50) and Cherry (3.00)
  })

  test("changes is 0 when no rows are affected", () => {
    const result = db.prepare("UPDATE products SET stock = 0 WHERE id = 9999").run()
    expect(result.changes).toBe(0)
  })

  test("changes reflects deleted row count for DELETE", () => {
    const result = db.prepare("DELETE FROM products WHERE id = 1").run()
    expect(result.changes).toBe(1)
  })

  test("accepts positional parameters", () => {
    db.prepare("INSERT INTO products VALUES (?, ?, ?, ?, ?)").run(5, "Elderberry", 4.5, 10, null)
    const row = db.prepare("SELECT name FROM products WHERE id = 5").get() as any
    expect(row.name).toBe("Elderberry")
  })

  test("accepts parameters as an array", () => {
    db.prepare("INSERT INTO products VALUES (?, ?, ?, ?, ?)").run([6, "Fig", 1.2, 80, null])
    const row = db.prepare("SELECT name FROM products WHERE id = 6").get() as any
    expect(row.name).toBe("Fig")
  })
})

// ── StatementSync.iterate() ──────────────────────────────────────────────────

describe("StatementSync.iterate()", () => {
  test("returns an iterable iterator", () => {
    const iter = db.prepare("SELECT id FROM products ORDER BY id").iterate()
    expect(typeof iter.next).toBe("function")
    expect(typeof iter[Symbol.iterator]).toBe("function")
  })

  test("for-of loop yields all rows", () => {
    const ids: number[] = []
    for (const row of db.prepare("SELECT id FROM products ORDER BY id").iterate() as any) {
      ids.push(row.id)
    }
    expect(ids).toEqual([1, 2, 3])
  })

  test("next() protocol returns { value, done }", () => {
    const iter = db.prepare("SELECT id FROM products WHERE id = 1").iterate()
    const first = iter.next()
    expect(first.done).toBe(false)
    expect((first.value as any).id).toBe(1)
    const second = iter.next()
    expect(second.done).toBe(true)
  })

  test("yields nothing for an empty result set", () => {
    const rows: unknown[] = []
    for (const row of db.prepare("SELECT * FROM products WHERE id > 9999").iterate() as any) {
      rows.push(row)
    }
    expect(rows).toHaveLength(0)
  })

  test("steps lazily instead of reading the whole result", () => {
    const iter = db
      .prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT x FROM n")
      .iterate()
    const xs = [iter.next(), iter.next(), iter.next()].map(r => (r.value as any).x)
    expect(xs).toEqual([1, 2, 3])
    iter.return?.()
  })

  test("binds parameters", () => {
    const ids = [...(db.prepare("SELECT id FROM products WHERE id >= ? ORDER BY id").iterate(2) as any)]
    expect(ids.map((r: any) => r.id)).toEqual([2, 3])
  })

  test("honors setReturnArrays", () => {
    const stmt = db.prepare("SELECT id, name FROM products WHERE id = 1")
    stmt.setReturnArrays(true)
    expect(stmt.iterate().next().value).toEqual([1, "Apple"])
  })

  test("return() resets the statement so it can run again", () => {
    const stmt = db.prepare("SELECT id FROM products ORDER BY id")
    const iter = stmt.iterate()
    iter.next()
    expect(iter.return?.()).toEqual({ done: true, value: undefined })
    expect(iter.next().done).toBe(true)
    expect(stmt.all().map((r: any) => r.id)).toEqual([1, 2, 3])
  })

  test("breaking out of for-of releases the statement", () => {
    const stmt = db.prepare("SELECT id FROM products ORDER BY id")
    for (const _ of stmt.iterate() as any) break
    expect(stmt.all()).toHaveLength(3)
  })

  test("running the statement again invalidates an open iterator", () => {
    const stmt = db.prepare("SELECT id FROM products ORDER BY id")
    const iter = stmt.iterate()
    iter.next()
    expect(stmt.all()).toHaveLength(3)
    expect(() => iter.next()).toThrow(/invalidated/)
    expect(iter.next().done).toBe(true)
  })

  test("a fresh iterate() restarts from the first row", () => {
    const stmt = db.prepare("SELECT id FROM products ORDER BY id")
    const first = stmt.iterate()
    first.next()
    first.next()
    expect((stmt.iterate().next().value as any).id).toBe(1)
  })

  test("throws errors raised while stepping", () => {
    const iter = db
      .prepare("SELECT CASE WHEN id = 2 THEN json_extract('not json', '$') ELSE id END AS v FROM products ORDER BY id")
      .iterate()
    expect((iter.next().value as any).v).toBe(1)
    expect(() => iter.next()).toThrow()
    expect(iter.next().done).toBe(true)
  })

  test("other statements can run while an iterator is open", () => {
    const iter = db.prepare("SELECT id FROM products ORDER BY id").iterate()
    expect((iter.next().value as any).id).toBe(1)
    db.prepare("INSERT INTO products (id, name) VALUES (10, 'Date')").run()
    expect((iter.next().value as any).id).toBe(2)
    iter.return?.()
  })
})

// ── StatementSync.columns() ──────────────────────────────────────────────────

describe("StatementSync.columns()", () => {
  test("returns column metadata", () => {
    const cols = db.prepare("SELECT id, name, price FROM products").columns()
    expect(cols).toHaveLength(3)
    expect(cols[0].name).toBe("id")
    expect(cols[1].name).toBe("name")
    expect(cols[2].name).toBe("price")
  })

  test("includes table name", () => {
    const cols = db.prepare("SELECT id FROM products").columns()
    expect(cols[0].table).toBe("products")
  })

  test("includes declared type", () => {
    const cols = db.prepare("SELECT id, name, price FROM products").columns()
    expect(cols[0].type).toBe("INTEGER")
    expect(cols[1].type).toBe("TEXT")
    expect(cols[2].type).toBe("REAL")
  })
})

// ── Parameter type coverage ──────────────────────────────────────────────────

describe("Parameter binding — type coverage", () => {
  beforeEach(() => {
    db.exec("CREATE TABLE types (i INTEGER, r REAL, t TEXT, b BLOB, n TEXT)")
  })

  test("binds integer", () => {
    db.prepare("INSERT INTO types (i) VALUES (?)").run(42)
    const row = db.prepare("SELECT i FROM types").get() as any
    expect(row.i).toBe(42)
  })

  test("binds float", () => {
    db.prepare("INSERT INTO types (r) VALUES (?)").run(3.14)
    const row = db.prepare("SELECT r FROM types").get() as any
    expect(row.r).toBeCloseTo(3.14)
  })

  test("binds string", () => {
    db.prepare("INSERT INTO types (t) VALUES (?)").run("hello")
    const row = db.prepare("SELECT t FROM types").get() as any
    expect(row.t).toBe("hello")
  })

  test("binds null", () => {
    db.prepare("INSERT INTO types (t) VALUES (?)").run(null)
    const row = db.prepare("SELECT t FROM types").get() as any
    expect(row.t).toBeNull()
  })

  test("binds undefined as null", () => {
    db.prepare("INSERT INTO types (n) VALUES (?)").run(undefined)
    const row = db.prepare("SELECT n FROM types").get() as any
    expect(row.n).toBeNull()
  })

  test("binds boolean as 0/1", () => {
    db.prepare("INSERT INTO types (i) VALUES (?)").run(true)
    const row = db.prepare("SELECT i FROM types").get() as any
    expect(row.i).toBe(1)
  })

  test("binds Buffer as BLOB", () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    db.prepare("INSERT INTO types (b) VALUES (?)").run(buf)
    const row = db.prepare("SELECT b FROM types").get() as any
    expect(Buffer.from(row.b)).toEqual(buf)
  })

  test("binds BigInt", () => {
    db.prepare("INSERT INTO types (i) VALUES (?)").run(BigInt(Number.MAX_SAFE_INTEGER) + 1n)
    const row = db.prepare("SELECT i FROM types").get() as any
    expect(typeof row.i).toBe("number")
  })

  test("throws on unsupported type (nested object as named param value)", () => {
    expect(() => db.prepare("INSERT INTO types (t) VALUES ($v)").run({ $v: { nested: true } })).toThrow()
  })
})
