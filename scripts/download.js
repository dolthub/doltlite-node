#!/usr/bin/env node
// Downloads the doltlite autoconf source tarball from GitHub releases and
// builds a complete amalgamation from it.
//
// The autoconf tarball contains both sqlite3.c (the base SQLite amalgamation
// with doltlite's storage patches) and the prolly tree + dolt SQL function
// source files under src/.  We stitch them into a single doltlite.c that,
// when compiled with -DDOLTLITE_PROLLY=1, has full version-control support.

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
const srcRoot   = path.join(__dirname, "../doltlite-src")

// Skip if already built.
if (fs.existsSync(outC) && fs.existsSync(outH)) {
  process.exit(0)
}

const tarballUrl = `https://github.com/dolthub/doltlite/releases/download/v${version}/doltlite-autoconf-${version}.tar.gz`
const tarballPath = path.join(__dirname, `../doltlite-autoconf-${version}.tar.gz`)

console.log(`Downloading doltlite source v${version}...`)

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest)
  function get(url) {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location)
      }
      if (res.statusCode !== 200) {
        cb(new Error(`HTTP ${res.statusCode} downloading ${url}`))
        return
      }
      res.pipe(file)
      file.on("finish", () => file.close(cb))
    }).on("error", cb)
  }
  get(url)
}

download(tarballUrl, tarballPath, (err) => {
  if (err) {
    console.error("Failed to download doltlite source:", err.message)
    process.exit(1)
  }

  try {
    fs.rmSync(srcRoot, { recursive: true, force: true })
    fs.mkdirSync(srcRoot, { recursive: true })

    // Extract tarball — tar is available on Linux, macOS, and Windows 10+.
    execSync(`tar xzf "${tarballPath}" -C "${srcRoot}"`, { stdio: "inherit" })
    fs.unlinkSync(tarballPath)

    // The tarball nests everything under doltlite-autoconf-${version}/.
    // Flatten it so doltlite-src/src/ and doltlite-src/sqlite3.c are the
    // canonical paths that build-amalgamation.js expects.
    const entries = fs.readdirSync(srcRoot)
    if (entries.length === 1 && fs.statSync(path.join(srcRoot, entries[0])).isDirectory()) {
      const subdir = path.join(srcRoot, entries[0])
      for (const f of fs.readdirSync(subdir)) {
        fs.renameSync(path.join(subdir, f), path.join(srcRoot, f))
      }
      fs.rmdirSync(subdir)
    }

    // Build the complete amalgamation.
    execSync(`node "${path.join(__dirname, "build-amalgamation.js")}"`, { stdio: "inherit" })

    console.log("Source ready.")
  } catch (e) {
    console.error("Failed to prepare doltlite source:", e.message)
    process.exit(1)
  }
})
