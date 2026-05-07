#!/usr/bin/env node
// Downloads the doltlite amalgamation from GitHub releases at install time.
// Version is read from package.json so it stays in sync automatically.

const https = require("https")
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const pkg = require("../package.json")
const version = pkg.version
const destDir = path.join(__dirname, "../amalgamation")
const amalgamationC = path.join(destDir, "doltlite.c")
const amalgamationH = path.join(destDir, "doltlite.h")

if (fs.existsSync(amalgamationC) && fs.existsSync(amalgamationH)) {
  process.exit(0)
}

fs.mkdirSync(destDir, { recursive: true })

const url = `https://github.com/dolthub/doltlite/releases/download/v${version}/doltlite-amalgamation-${version}.zip`
const zipPath = path.join(destDir, "amalgamation.zip")

console.log(`Downloading doltlite amalgamation v${version}...`)

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

download(url, zipPath, (err) => {
  if (err) {
    console.error("Failed to download amalgamation:", err.message)
    process.exit(1)
  }
  try {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" })

    // The zip may nest files in a subdirectory — move them up if needed.
    const entries = fs.readdirSync(destDir).filter((f) => f !== "amalgamation.zip")
    if (entries.length === 1 && fs.statSync(path.join(destDir, entries[0])).isDirectory()) {
      const subdir = path.join(destDir, entries[0])
      for (const f of fs.readdirSync(subdir)) {
        fs.renameSync(path.join(subdir, f), path.join(destDir, f))
      }
      fs.rmdirSync(subdir)
    }

    fs.unlinkSync(zipPath)
    console.log("Amalgamation ready.")
  } catch (e) {
    console.error("Failed to extract amalgamation:", e.message)
    process.exit(1)
  }
})
