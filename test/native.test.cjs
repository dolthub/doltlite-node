"use strict"

const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")
const { DatabaseSync } = require(process.env.DOLTLITE_TEST_PACKAGE || "../index")

function sqliteError(run, errcode, operation) {
  assert.throws(run, error => {
    assert.equal(error.code, "ERR_SQLITE_ERROR")
    assert.equal(error.errcode, errcode)
    assert.equal(typeof error.errstr, "string")
    assert.equal(error.operation, operation)
    return true
  })
}

function withDirectory(run) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doltlite-native-")))
  try {
    run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test("preserves extended SQLite errors through exec and every statement entry point", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`CREATE TABLE t(id TEXT PRIMARY KEY, name TEXT UNIQUE, required TEXT NOT NULL);
             INSERT INTO t VALUES ('one','first','yes')`)
    const insert = "INSERT INTO t VALUES (?, ?, ?) RETURNING id"
    sqliteError(() => db.exec("INSERT INTO t VALUES ('one','second','yes')"), 1555, "exec")
    sqliteError(() => db.exec("INSERT INTO t VALUES ('two','first','yes')"), 2067, "exec")
    sqliteError(() => db.exec("INSERT INTO t VALUES ('two','second',NULL)"), 1299, "exec")
    sqliteError(() => db.prepare("SELECT * FROM missing_table"), 1, "prepare")

    for (const method of ["run", "get", "all", "iterate"]) {
      const stmt = db.prepare(insert)
      const result = (...params) => {
        const value = stmt[method](...params)
        return method === "iterate" ? [...value] : value
      }
      sqliteError(() => result("one", "second", "yes"), 1555, method)
      sqliteError(() => result("one", "second", "yes"), 1555, method)
      result(method, method, "yes")
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM t WHERE id = ?").get(method).n, 1)
    }
    sqliteError(() => db.doltCheckout("no-such-branch"), 1, "SELECT dolt_checkout(?)")
  } finally {
    db.close()
  }
})

test("distinguishes ordinary writer contention from a stale read snapshot", () => {
  withDirectory(dir => {
    const filename = path.join(dir, "db")
    const reader = new DatabaseSync(filename)
    const writer = new DatabaseSync(filename)
    try {
      reader.exec("PRAGMA busy_timeout=0; CREATE TABLE t(id INTEGER PRIMARY KEY, v INT); INSERT INTO t VALUES (1,0)")
      writer.exec("PRAGMA busy_timeout=0")
      reader.exec("BEGIN IMMEDIATE")
      sqliteError(() => writer.exec("UPDATE t SET v=1"), 5, "exec")
      reader.exec("ROLLBACK; BEGIN")
      reader.prepare("SELECT * FROM t").all()
      writer.exec("UPDATE t SET v=1")
      sqliteError(() => reader.prepare("UPDATE t SET v=2").run(), 517, "run")
      reader.exec("ROLLBACK")
    } finally {
      reader.close()
      writer.close()
    }
  })
})

test("reports native failures from both database open paths", () => {
  withDirectory(dir => {
    const filename = path.join(dir, "missing", "db")
    sqliteError(() => new DatabaseSync(filename), 14, "open")
    const db = new DatabaseSync(filename, { open: false })
    sqliteError(() => db.open(filename), 14, "open")
    assert.equal(db.isOpen, false)
  })
})

test("close releases the database files and invalidates surviving statements and iterators", () => {
  withDirectory(dir => {
    const filename = path.join(dir, "db")
    const db = new DatabaseSync(filename)
    try {
      db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1),(2)")
      const stmt = db.prepare("SELECT id FROM t ORDER BY id")
      const iter = stmt.iterate()
      assert.equal(iter.next().value.id, 1)
      db.close()
      assert.equal(db.isOpen, false)
      if (process.platform === "win32") {
        for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file))
      } else if (process.platform === "darwin") {
        const files = execFileSync("/usr/sbin/lsof", ["-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" })
        assert.ok(!files.includes(dir + path.sep), files.split("\n").filter(line => line.includes(dir)).join("\n"))
      } else if (process.platform === "linux") {
        const files = fs.readdirSync("/proc/self/fd").flatMap(fd => {
          try {
            return [fs.readlinkSync(`/proc/self/fd/${fd}`)]
          } catch (error) {
            if (error.code !== "ENOENT") throw error
            return []
          }
        })
        assert.deepEqual(files.filter(file => file.startsWith(dir + path.sep)), [])
      }
      assert.throws(() => iter.next(), /finalised/)
      db.open(filename)
      assert.throws(() => stmt.get(), /finalised/)
      assert.equal(db.prepare("SELECT 42 AS n").get().n, 42)
    } finally {
      db.close()
    }
  })
})

test("a surviving statement remains usable after its database wrapper is collected", async () => {
  const stmt = new DatabaseSync(":memory:").prepare("SELECT 42 AS n")
  await new Promise(resolve => setImmediate(resolve))
  if (globalThis.Bun) globalThis.Bun.gc(true)
  else globalThis.gc?.()
  assert.equal(stmt.get().n, 42)
})

test("a binding getter cannot close a connection while the statement is running", () => {
  const db = new DatabaseSync(":memory:")
  try {
    const stmt = db.prepare("SELECT $n AS n")
    const row = stmt.get({
      get $n() {
        assert.throws(() => db.close(), /statement is executing/)
        return 42
      },
    })
    assert.equal(row.n, 42)
  } finally {
    db.close()
  }
})

test("includes vec1 and SQLite math functions and accepts typed array BLOBs", () => {
  const db = new DatabaseSync(":memory:")
  try {
    const zero = new Uint8Array(new Float32Array([0, 0]).buffer)
    const buffer = new Float32Array([999, 3, 4]).buffer
    const point = new Uint8Array(buffer, 4)
    assert.equal(db.prepare("SELECT sqrt(vec1_l2_distance(?,?)) AS distance").get(zero, point).distance, 5)
    assert.ok(Math.abs(db.prepare("SELECT vec1_cos_distance(?,?) AS distance").get(point, point).distance) < 1e-6)
    assert.equal(db.prepare("SELECT hex(?) AS value").get(new DataView(buffer, 4)).value,
                 Buffer.from(point).toString("hex").toUpperCase())
    assert.equal(db.prepare("SELECT typeof(?) AS type").get(new Uint8Array()).type, "blob")
  } finally {
    db.close()
  }
})
