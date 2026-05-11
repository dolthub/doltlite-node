"use strict"

const path = require("path")
const fs = require("fs")

// Try a prebuilt binary first (shipped with published packages),
// then fall back to a locally compiled build.
function loadAddon() {
  const platform = process.platform
  const arch = process.arch
  const prebuilt = path.join(__dirname, "prebuilds", `${platform}-${arch}`, "doltlite.node")
  const compiled = path.join(__dirname, "build", "Release", "doltlite.node")

  for (const candidate of [prebuilt, compiled]) {
    try {
      return require(candidate)
    } catch {}
  }

  throw new Error(
    `@dolthub/doltlite: no native binary found for ${platform}-${arch}.\n` +
    `Run \`npm install\` to build from source, or file an issue at ` +
    `https://github.com/dolthub/doltlite-node/issues`
  )
}

// Absolute path to the platform's `doltlite` CLI binary, shipped in the
// package's prebuilds/ alongside the .node addon. Used by consumers (e.g.
// opencode) that want to spawn an interactive shell or pipe SQL through
// the doltlite shell. Throws if the binary isn't bundled for this platform.
function binPath() {
  const platform = process.platform
  const arch = process.arch
  const ext = platform === "win32" ? ".exe" : ""
  const candidate = path.join(__dirname, "prebuilds", `${platform}-${arch}`, `doltlite${ext}`)
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `@dolthub/doltlite: no doltlite CLI binary bundled for ${platform}-${arch}.\n` +
      `Expected at ${candidate}. File an issue at ` +
      `https://github.com/dolthub/doltlite-node/issues`
    )
  }
  return candidate
}

const { DatabaseSync, StatementSync } = loadAddon()
module.exports = { DatabaseSync, StatementSync, binPath }
