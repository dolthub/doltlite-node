"use strict"

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const pkg = require("../package.json")
const targets = require("./release-targets.json").include

const [spec, ...options] = process.argv.slice(2)
const npm = process.env.npm_execpath
assert.ok(spec && npm, "Usage: npm run test:package -- <tarball or package spec> [--source] [--bun]")
const source = options.includes("--source")
const bun = options.includes("--bun")
const key = `${process.platform}-${process.arch}`
const target = targets.find(entry => entry.target === key)
assert.ok(source || target, `No prebuilt release target for ${key}`)

const root = path.join(__dirname, "..")
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doltlite-package-"))
const installed = path.join(dir, "node_modules", pkg.name)
const prebuilt = path.join(installed, "prebuilds", key, "doltlite.node")
const compiled = path.join(installed, "build", "Release", "doltlite.node")

function runNpm(args, cwd) {
  execFileSync(process.execPath, [npm, ...args], { cwd, stdio: "inherit" })
}

try {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ private: true }))
  const dependency = fs.existsSync(spec) ? path.resolve(spec) : spec
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", dependency], dir)
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8")).version, pkg.version)

  if (source) {
    if (fs.existsSync(prebuilt)) fs.unlinkSync(prebuilt)
    runNpm(["run", "install"], installed)
    assert.ok(fs.existsSync(compiled), "Source install did not produce a native addon")
  } else {
    assert.ok(fs.existsSync(prebuilt), `Packaged addon missing for ${key}`)
    assert.ok(!fs.existsSync(compiled), "Prebuilt package unexpectedly contains a local build")
  }

  const tests = ["consumer.test.cjs"]
  fs.copyFileSync(path.join(__dirname, tests[0]), path.join(dir, tests[0]))
  for (const filename of fs.readdirSync(path.join(root, "test"))) {
    if (!filename.endsWith(".test.cjs")) continue
    fs.copyFileSync(path.join(root, "test", filename), path.join(dir, filename))
    tests.push(filename)
  }

  const env = {
    ...process.env,
    DOLTLITE_TEST_PACKAGE: pkg.name,
    DOLTLITE_EXPECT_VERSION: `v${pkg.version}`,
    DOLTLITE_EXPECT_CLI: target?.cli || "",
  }
  execFileSync(process.execPath, ["--test", ...tests], { cwd: dir, env, stdio: "inherit" })
  if (bun) execFileSync("bun", ["test", ...tests], { cwd: dir, env, stdio: "inherit" })
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
