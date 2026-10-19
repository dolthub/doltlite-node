"use strict"

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "doltlite-package-"))

try {
  const packed = JSON.parse(execFileSync("npm", [
    "pack", "--ignore-scripts", "--json", "--pack-destination", tmp,
  ], { cwd: root, encoding: "utf8" }))
  execFileSync("tar", ["xzf", path.join(tmp, packed[0].filename), "-C", tmp])
  const packageRoot = path.join(tmp, "package")
  for (const platform of ["linux-x64", "darwin-arm64"]) {
    const cli = path.join(packageRoot, "prebuilds", platform, "doltlite")
    assert.notEqual(fs.statSync(cli).mode & 0o111, 0, `${platform} CLI is not executable`)
  }
  const { DatabaseSync, binPath } = require(packageRoot)
  const db = new DatabaseSync(":memory:")
  try {
    assert.equal(db.prepare("SELECT doltlite_engine() AS engine").get().engine, "prolly")
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1)")
    assert.equal(db.prepare("SELECT count(*) AS n FROM t").get().n, 1)
  } finally {
    db.close()
  }
  assert.equal(execFileSync(binPath(), [":memory:", "SELECT doltlite_engine();"], {
    encoding: "utf8",
  }).trim(), "prolly")
  console.log("npm archive: native addon and executable bundled CLIs PASS")
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
