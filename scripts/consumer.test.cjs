"use strict"

const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const { test } = require("node:test")
const { DatabaseSync, binPath } = require("@dolthub/doltlite")

const version = process.env.DOLTLITE_EXPECT_VERSION

test("installed addon commits, merges and reopens with the expected engine", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "doltlite-consumer-"))
  const filename = path.join(dir, "test.db")
  const db = new DatabaseSync(filename)
  try {
    assert.equal(db.prepare("SELECT doltlite_engine() AS engine").get().engine, "prolly")
    assert.equal(db.doltVersion(), version)
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, text TEXT, bytes BLOB, big INTEGER, missing TEXT)")
    db.prepare("INSERT INTO t VALUES (?, ?, ?, ?, ?)").run(1, "café", Buffer.from([0, 255]), 9223372036854775807n, null)
    db.exec("BEGIN; UPDATE t SET text='rolled back'; ROLLBACK")
    assert.ok(db.doltCommit("base"))
    db.doltBranch("topic")
    db.doltCheckout("topic")
    db.exec("UPDATE t SET text='café on topic'")
    assert.ok(db.doltCommit("topic work"))
    db.doltCheckout("main")
    assert.equal(db.prepare("SELECT text FROM t").get().text, "café")
    db.doltMerge("topic")
    db.close()
    db.open(filename)
    const stmt = db.prepare("SELECT text, hex(bytes) AS bytes, big, missing FROM t")
    stmt.setReadBigInts(true)
    const row = stmt.get()
    assert.equal(row.text, "café on topic")
    assert.equal(row.bytes, "00FF")
    assert.equal(row.big, 9223372036854775807n)
    assert.equal(row.missing, null)
    assert.equal(db.prepare("SELECT count(*) AS n FROM dolt_log WHERE message='topic work'").get().n, 1)
  } finally {
    db.close()
  }
})

test("installed CLI matches the addon on platforms with a bundled executable", () => {
  if (!process.env.DOLTLITE_EXPECT_CLI) {
    assert.throws(binPath, /no doltlite CLI binary bundled/)
    return
  }
  const cli = binPath()
  assert.equal(path.basename(cli), process.env.DOLTLITE_EXPECT_CLI)
  const output = execFileSync(cli, [":memory:", "SELECT doltlite_engine(), dolt_version();"], {
    encoding: "utf8",
    timeout: 10000,
  })
  assert.equal(output.trim(), `prolly|${version}`)
})
