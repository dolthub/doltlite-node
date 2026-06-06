#!/usr/bin/env node
// Downloads the doltlite autoconf source tarball from GitHub releases,
// prepares its released amalgamation for node-gyp, and bundles the matching doltlite
// CLI binary for the current platform into prebuilds/${platform}-${arch}/
// so that binPath() can return an absolute path.
//
// The autoconf tarball contains a self-contained sqlite3.c with DoltLite's
// prolly tree and SQL function sources already included. We copy it to
// amalgamation/doltlite.c so the addon builds the exact released source.

"use strict"

const https  = require("https")
const fs     = require("fs")
const path   = require("path")
const { execSync } = require("child_process")

const pkg     = require("../package.json")
const version = pkg.version

const amalgDir  = path.join(__dirname, "../amalgamation")
const outC      = path.join(amalgDir, "doltlite.c")
const outH      = path.join(amalgDir, "doltlite.h")
const versionMarker = path.join(amalgDir, ".doltlite-source-version")
const srcRoot   = path.join(amalgDir, ".source")

function normalizeVersion(v) {
  return String(v || "").trim().replace(/^v/, "")
}

function sourceReady() {
  if (!fs.existsSync(outC) || !fs.existsSync(outH) || !fs.existsSync(versionMarker)) return false
  try {
    const marker = fs.readFileSync(versionMarker, "utf8")
    return normalizeVersion(marker) === normalizeVersion(version)
  } catch (_) {
    return false
  }
}

// Upstream dolthub/doltlite ships the CLI for these platform-arch pairs;
// place the binary next to the .node addon so binPath() can return it.
const CLI_TOOLS = {
  "linux-x64":    { upstream: "linux-x64",  bin: "doltlite" },
  "darwin-arm64": { upstream: "osx-arm64",  bin: "doltlite" },
  "win32-x64":    { upstream: "win-x64",    bin: "doltlite.exe" },
}

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest)
  function get(u) {
    https.get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location)
      }
      if (res.statusCode !== 200) {
        cb(new Error(`HTTP ${res.statusCode} downloading ${u}`))
        return
      }
      res.pipe(file)
      file.on("finish", () => file.close(cb))
    }).on("error", cb)
  }
  get(url)
}

function fetchSource(cb) {
  if (sourceReady()) return cb()

  const tarballUrl = `https://github.com/dolthub/doltlite/releases/download/v${version}/doltlite-autoconf-${version}.tar.gz`
  const tarballPath = path.join(__dirname, `../doltlite-autoconf-${version}.tar.gz`)
  console.log(`Downloading doltlite source v${version}...`)

  download(tarballUrl, tarballPath, (err) => {
    if (err) return cb(new Error(`Failed to download source: ${err.message}`))
    try {
      fs.rmSync(srcRoot, { recursive: true, force: true })
      fs.mkdirSync(srcRoot, { recursive: true })
      execSync(`tar xzf "${tarballPath}" -C "${srcRoot}"`, { stdio: "inherit" })
      fs.unlinkSync(tarballPath)

      // The tarball nests under doltlite-autoconf-${version}/. Flatten so
      // doltlite-src/src/ and doltlite-src/sqlite3.c are canonical.
      const entries = fs.readdirSync(srcRoot)
      if (entries.length === 1 && fs.statSync(path.join(srcRoot, entries[0])).isDirectory()) {
        const subdir = path.join(srcRoot, entries[0])
        for (const f of fs.readdirSync(subdir)) {
          fs.renameSync(path.join(subdir, f), path.join(srcRoot, f))
        }
        fs.rmdirSync(subdir)
      }
      execSync(`node "${path.join(__dirname, "build-amalgamation.js")}"`, { stdio: "inherit" })
      console.log("Source ready.")
      cb()
    } catch (e) {
      cb(new Error(`Failed to prepare doltlite source: ${e.message}`))
    }
  })
}

function fetchCli(cb) {
  const key = `${process.platform}-${process.arch}`
  const meta = CLI_TOOLS[key]
  if (!meta) {
    console.log(`doltlite CLI: no upstream build for ${key}, skipping`)
    return cb()
  }
  const prebuildDir = path.join(__dirname, "..", "prebuilds", key)
  const binPath = path.join(prebuildDir, meta.bin)
  if (fs.existsSync(binPath)) return cb()
  fs.mkdirSync(prebuildDir, { recursive: true })

  const url = `https://github.com/dolthub/doltlite/releases/download/v${version}/doltlite-tools-${meta.upstream}-${version}.zip`
  const zipPath = path.join(__dirname, `../doltlite-tools-${meta.upstream}-${version}.zip`)
  console.log(`Downloading doltlite CLI v${version} for ${key}...`)
  download(url, zipPath, (err) => {
    if (err) return cb(new Error(`Failed to download CLI: ${err.message}`))
    try {
      execSync(`unzip -jo "${zipPath}" "*/${meta.bin}" -d "${prebuildDir}"`, { stdio: "inherit" })
      fs.unlinkSync(zipPath)
      if (process.platform !== "win32") fs.chmodSync(binPath, 0o755)
      cb()
    } catch (e) {
      cb(new Error(`Failed to extract CLI: ${e.message}`))
    }
  })
}

fetchSource((err) => {
  if (err) {
    console.error(err.message)
    process.exit(1)
  }
  fetchCli((cliErr) => {
    if (cliErr) {
      // Non-fatal: the addon still builds and works; binPath() will throw
      // if a consumer invokes it without the CLI present.
      console.error(`doltlite CLI: ${cliErr.message} (addon will still build)`)
    }
    process.exit(0)
  })
})
