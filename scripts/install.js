#!/usr/bin/env node
// Uses a packaged native prebuild when available, otherwise prepares source
// and builds the addon locally.

"use strict"

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const root = path.join(__dirname, "..")
const prebuilt = path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "doltlite.node")

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status || 1)
}

if (fs.existsSync(prebuilt)) {
  console.log(`@dolthub/doltlite: using prebuilt addon ${path.relative(root, prebuilt)}`)
  process.exit(0)
}

run(process.execPath, [path.join(__dirname, "download.js")])
run("node-gyp", ["rebuild"])
