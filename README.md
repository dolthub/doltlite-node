# @dolthub/doltlite

Node.js native bindings for [DoltLite](https://github.com/dolthub/doltlite) — a SQLite fork that adds Git-style version control (branches, commits, merges, diffs, blame) to your SQL database.

[![CI](https://github.com/dolthub/doltlite-node/actions/workflows/ci.yml/badge.svg)](https://github.com/dolthub/doltlite-node/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dolthub/doltlite)](https://www.npmjs.com/package/@dolthub/doltlite)

## Install

```bash
npm install @dolthub/doltlite
# or
bun add @dolthub/doltlite
```

Prebuilt binaries are provided for Linux x64/arm64, macOS x64/arm64, and Windows x64. On unsupported platforms the package builds from source via `node-gyp`, which requires a C/C++ toolchain and Python 3.

## Drop-in compatibility with `node:sqlite`

`DatabaseSync` and `StatementSync` match the [Node.js `node:sqlite`](https://nodejs.org/api/sqlite.html) API exactly. Switch by changing one import line:

```diff
-import { DatabaseSync } from "node:sqlite"
+import { DatabaseSync } from "@dolthub/doltlite"
```

## Basic usage

```ts
import { DatabaseSync } from "@dolthub/doltlite"

const db = new DatabaseSync("myapp.db")

db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`)

const insert = db.prepare("INSERT INTO users (name) VALUES (?)")
insert.run("Alice")
insert.run("Bob")

const all = db.prepare("SELECT * FROM users")
console.log(all.all())
// [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]

db.close()
```

## Version control

All Dolt features are methods on `DatabaseSync` under `dolt*` names:

```ts
const db = new DatabaseSync("versioned.db")

db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)`)
db.exec(`INSERT INTO orders VALUES (1, 99.99)`)

// Commit the current state
const hash = db.doltCommit("initial data")

// Branch and make changes
db.doltBranch("experiment")
db.doltCheckout("experiment")
db.exec(`INSERT INTO orders VALUES (2, 49.99)`)
db.doltCommit("add order 2")

// See what changed
console.log(db.doltStatus())
console.log(db.doltLog({ limit: 5 }))

// Merge back to main
db.doltCheckout("main")
const result = db.doltMerge("experiment")
console.log(result) // { fast_forward: 0, conflicts: 0 }

// Inspect history
console.log(db.doltDiff("HEAD~1", "HEAD", "orders"))
console.log(db.doltHistoryOf("orders"))
console.log(db.doltBlameOf("orders"))

// Tag a release
db.doltTag("v1.0.0")

db.close()
```

You can also call Dolt SQL functions directly if you prefer:

```ts
db.exec("SELECT dolt_commit('-Am', 'my message')")
```

## API

### `new DatabaseSync(path, options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `open` | boolean | `true` | Open immediately |
| `readOnly` | boolean | `false` | Read-only mode |

### node:sqlite-compatible methods

| Method | Description |
|--------|-------------|
| `exec(sql)` | Run SQL, no return value |
| `prepare(sql)` | Compile a `StatementSync` |
| `close()` | Close the connection |
| `open(path)` | (Re-)open at path |
| `location()` | Filesystem path, or `null` for `:memory:` |
| `createFunction(name, fn)` | Register a scalar UDF |
| `.isOpen` | `true` if connection is open |
| `.inTransaction` | `true` if inside a transaction |

### StatementSync

| Method | Returns |
|--------|---------|
| `run(...params)` | `{ changes, lastInsertRowid }` |
| `get(...params)` | First row object, or `undefined` |
| `all(...params)` | All row objects |
| `iterate(...params)` | `IterableIterator` |
| `columns()` | Column metadata array |
| `.sourceSQL` | Original SQL text |
| `.expandedSQL` | SQL with parameters expanded |

### Dolt methods

| Method | Returns | Description |
|--------|---------|-------------|
| `doltCommit(message)` | `string` (hash) | Stage all and commit |
| `doltBranch(name, from?)` | `void` | Create a branch |
| `doltCheckout(branch)` | `void` | Switch branch |
| `doltMerge(branch)` | `{ fast_forward, conflicts }` | Merge a branch |
| `doltReset(flag?)` | `void` | Reset HEAD; pass `"--hard"` for hard reset |
| `doltAdd(table?)` | `void` | Stage a table, or all tables |
| `doltStatus()` | `DoltStatusEntry[]` | Working-set status |
| `doltLog(opts?)` | `DoltCommit[]` | Commit history, newest first |
| `doltBranches()` | `DoltBranchInfo[]` | All branches |
| `doltActiveBranch()` | `string` | Currently checked-out branch |
| `doltDiff(from, to, table)` | `DoltDiffRow[]` | Row-level diff between two refs |
| `doltHashOf(ref?)` | `string` | Content hash of the DB at a ref |
| `doltVersion()` | `string` | DoltLite version string |
| `doltTag(name)` | `void` | Create a tag at HEAD |
| `doltTags()` | `DoltTagInfo[]` | All tags |
| `doltHistoryOf(table)` | `object[]` | Full row history across all commits |
| `doltBlameOf(table)` | `object[]` | Per-row blame |
| `doltCherryPick(hash)` | `void` | Cherry-pick a commit onto HEAD |
| `doltRevert(ref?)` | `void` | Revert a commit (default: HEAD) |

### `binPath()`

Returns the absolute path to the bundled `doltlite` CLI binary for the current platform. Useful when a consumer wants to spawn the shell directly — e.g. for an interactive `db` subcommand — rather than driving everything through the Node bindings.

```javascript
import { binPath } from "@dolthub/doltlite"
import { spawn } from "child_process"

const child = spawn(binPath(), ["mydata.db"], { stdio: "inherit" })
```

Throws if no CLI build is bundled for the current platform/arch. (Upstream currently ships CLI tools for `linux-x64`, `darwin-arm64`, and `win32-x64`; the `.node` addon covers more platforms than the shell.)

## Building from source

```bash
git clone https://github.com/dolthub/doltlite-node
cd doltlite-node
npm install   # downloads amalgamation + compiles
bun test      # run the test suite
```

**Requirements:** Python 3, and a C/C++ compiler (`gcc`/`clang` on Linux/macOS, MSVC Build Tools on Windows).

## Versioning

The package version tracks the DoltLite version. `@dolthub/doltlite@0.10.0` ships the DoltLite 0.10.0 amalgamation.

## License

Apache-2.0. See [DoltLite](https://github.com/dolthub/doltlite) for the underlying library.
