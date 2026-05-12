#!/usr/bin/env node
// Builds a complete doltlite amalgamation from the autoconf source tree.
//
// Generates two C files:
//
//   amalgamation/doltlite_orig.c  — the original SQLite btree/pager/wal/backup code
//       compiled with btree_orig_prefix.h so every exported symbol gets an orig_
//       prefix.  This keeps the original implementation available alongside the
//       prolly-tree replacements.  Compiled as a separate translation unit so its
//       struct definitions (original BtShared, Pager, etc.) don't clash with the
//       prolly versions in doltlite.c.
//
//   amalgamation/doltlite.c  — the base sqlite3.c amalgamation (with btree/pager/
//       wal/btmutex/backup sections wrapped in #ifndef DOLTLITE_PROLLY), followed
//       by the blake3, prolly-tree, and doltlite SQL-function source files.
//
// When both files are compiled with -DDOLTLITE_PROLLY=1, the full version-
// control stack is active.  Without that flag doltlite.c degrades to plain SQLite
// and doltlite_orig.c is a harmless dead-code object.

"use strict"

const fs = require("fs")
const path = require("path")

const { version } = require("../package.json")

const srcRoot    = path.join(__dirname, "../doltlite-src")
const baseSqlite = path.join(srcRoot, "sqlite3.c")
const srcDir     = path.join(srcRoot, "src")
const blake3Dir  = path.join(srcRoot, "ext", "blake3")
const outDir     = path.join(__dirname, "../amalgamation")
const outFile    = path.join(outDir, "doltlite.c")
const outOrig    = path.join(outDir, "doltlite_orig.c")
const outHeader  = path.join(outDir, "doltlite.h")

// Files in the sqlite3.c amalgamation whose symbols are replaced by prolly_btree.c / pager_shim.c.
// They are wrapped in #ifndef DOLTLITE_PROLLY so the compiler only sees one definition.
const GUARDED = ["btree.c", "pager.c", "wal.c", "btmutex.c", "backup.c"]

// Source files to append to doltlite.c.
// Each entry is either a filename relative to srcDir, or an absolute path.
// Order matters: lower-level files before the code that calls them.
const EXTRA = [
  // blake3 hash library (required by prolly_hash.c, lives in ext/blake3/)
  // blake3_dispatch.c replaced blake3_dispatch_portable.c in 0.10.6.
  path.join(blake3Dir, "blake3.c"),
  path.join(blake3Dir, "blake3_portable.c"),
  path.join(blake3Dir, fs.existsSync(path.join(blake3Dir, "blake3_dispatch.c"))
    ? "blake3_dispatch.c" : "blake3_dispatch_portable.c"),
  // prolly tree
  "prolly_hash.c",
  "prolly_xxhash.c",
  "prolly_hashset.c",
  "prolly_node.c",
  "prolly_cache.c",
  "chunk_store.c",
  "prolly_cursor.c",
  "prolly_mutmap.c",
  "prolly_chunker.c",
  "prolly_mutate.c",
  "prolly_diff.c",
  "prolly_three_way_diff.c",
  "prolly_three_way_merge.c",
  "prolly_btree.c",
  "pager_shim.c",
  "sortkey.c",
  // dolt SQL functions
  "doltlite.c",
  "doltlite_commit.c",
  "doltlite_ref.c",
  "doltlite_log.c",
  "doltlite_status.c",
  "doltlite_diff.c",
  "doltlite_diff_table.c",
  "doltlite_branch.c",
  "doltlite_tag.c",
  "doltlite_ancestor.c",
  "doltlite_commit_ancestors.c",
  "doltlite_merge.c",
  "doltlite_schema_merge.c",
  "doltlite_conflicts.c",
  "doltlite_gc.c",
  "doltlite_chunk_walk.c",
  "doltlite_history.c",
  "doltlite_at.c",
  "doltlite_blame.c",
  "doltlite_schema_diff.c",
  "doltlite_schemas.c",
  "doltlite_diff_stat.c",
  "doltlite_record.c",
  "doltlite_ignore.c",
  "doltlite_hashof.c",
  "doltlite_constraint_violations.c",
  "doltlite_merge_constraints.c",
  "doltlite_dbpage.c",
  "doltlite_remote.c",
  "doltlite_remote_sql.c",
  "doltlite_http_remote.c",
  "doltlite_remotesrv.c",
]

// Per-file symbol renames to resolve conflicts when multiple source files are
// merged into a single translation unit.
// Each entry: { file: basename, renames: [[oldWord, newWord], ...] }
// Replacements are applied as whole-word substitutions (word-boundary regex).
const FILE_PATCHES = [
  {
    // prolly_btree.c defines struct TableEntry, struct SchemaEntry, and
    // tableEntryNameCmp/buildSchemaCatalogRecord — rename the duplicates that
    // appear later in doltlite_merge.c so they don't collide.
    file: "doltlite_merge.c",
    renames: [
      // Rename the local MergeFieldValue (used only by buildSchemaCatalogRecord)
      // so it doesn't clash with doltlite_merge_constraints.c's MergeFieldValue.
      ["mergeCatalogSerialType",  "dlMergeCatalogSerialType"],
      ["mergeCatalogSerialPut",   "dlMergeCatalogSerialPut"],
      ["MergeFieldValue",         "DlMergeSchemaMFV"],
      // buildSchemaCatalogRecord is also defined in prolly_btree.c.
      ["buildSchemaCatalogRecord","dlMergeBuildSchemaRecord"],
      // ConflictRow is embedded in RowMergeCtx here; doltlite_conflicts.c also
      // embeds an identically-named struct → rename the merge.c version.
      ["ConflictRow",             "DlMergeConflictRow"],
      // freeConflictTables has a different signature in doltlite_conflicts.c.
      ["freeConflictTables",      "dlMergeFreeConflictTables"],
    ],
  },
  {
    // doltlite_merge_constraints.c defines its own MergeFieldValue (which has
    // an extra `double r` field vs the one in doltlite_merge.c).
    file: "doltlite_merge_constraints.c",
    renames: [
      ["mergeSerialType",         "dlConstraintMergeSerialType"],
      ["mergeSerialPut",          "dlConstraintMergeSerialPut"],
      ["MergeFieldValue",         "DlConstraintMFV"],
    ],
  },
  {
    // writeAll is also defined (identically) in doltlite_http_remote.c which
    // comes earlier in the EXTRA list.
    file: "doltlite_remotesrv.c",
    renames: [
      ["writeAll", "srvWriteAll"],
    ],
  },
]

// Per-file exact text patches (verbatim old → new, applied after renames).
// Each entry: { file: basename, patches: [[oldText, newText], ...] }
const FILE_TEXT_PATCHES = [
  {
    // os_win.c does not implement SQLITE_FCNTL_HAS_MOVED; sqlite3OsFileControl
    // returns SQLITE_NOTFOUND ("unknown operation") for that opcode.
    // csDetectExternalChanges previously propagated that error, so every write
    // transaction on a file-based database failed on Windows.  Treat NOTFOUND
    // the same way the standard pager does: assume the file has not moved.
    file: "chunk_store.c",
    patches: [
      // 0.10.5 used 2-space indent; 0.10.6 uses 4-space inside the hasMovedChecked guard.
      [
        `    rc = sqlite3OsFileControl(cs->pFile, SQLITE_FCNTL_HAS_MOVED, &bMoved);\n    if( rc!=SQLITE_OK ) return rc;\n    if( bMoved ){`,
        `    rc = sqlite3OsFileControl(cs->pFile, SQLITE_FCNTL_HAS_MOVED, &bMoved);\n    if( rc==SQLITE_NOTFOUND ) rc = SQLITE_OK; /* not supported by this VFS */\n    if( rc!=SQLITE_OK ) return rc;\n    if( bMoved ){`,
      ],
      // On Windows, csFileLock / csFileLockNB opened the database file itself
      // and held an exclusive byte-range lock over ALL bytes.  sqlite3OsWrite
      // then tried to write via cs->pFile (a different HANDLE to the same path).
      // Windows exclusive byte-range locks block WriteFile from other handles —
      // even handles in the same process — causing SQLITE_IOERR_WRITE after the
      // winRetryIoerr retry loop.  Fix: use a separate "<path>.lock" file so
      // the lock fd and the I/O fd never conflict.
      [
        `#ifdef _WIN32\n# include <io.h>\n# include <windows.h>\n  static int csFileLock(const char *path, int *pFd){\n    int fd = _open(path, _O_BINARY | _O_RDWR | _O_CREAT, 0644);\n    if( fd < 0 ) return -1;\n    {\n      HANDLE h = (HANDLE)_get_osfhandle(fd);\n      OVERLAPPED ov = {0};\n      if( !LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK, 0, MAXDWORD, MAXDWORD, &ov) ){\n        _close(fd);\n        return -1;\n      }\n    }\n    *pFd = fd;\n    return 0;\n  }\n  static void csFileUnlock(int fd){\n    if( fd >= 0 ){\n      HANDLE h = (HANDLE)_get_osfhandle(fd);\n      OVERLAPPED ov = {0};\n      UnlockFileEx(h, 0, MAXDWORD, MAXDWORD, &ov);\n      _close(fd);\n    }\n  }\n  static int csFileLockNB(const char *path, int *pFd){\n    int fd = _open(path, _O_BINARY | _O_RDWR | _O_CREAT, 0644);\n    if( fd < 0 ) return -1;\n    {\n      HANDLE h = (HANDLE)_get_osfhandle(fd);\n      OVERLAPPED ov = {0};\n      if( !LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,\n                       0, MAXDWORD, MAXDWORD, &ov) ){\n        _close(fd);\n        return -1;\n      }\n    }\n    *pFd = fd;\n    return 0;\n  }\n#else`,
        `#ifdef _WIN32\n# include <io.h>\n# include <windows.h>\n  /* Use a separate "<path>.lock" file for byte-range locking so that\n  ** LockFileEx on the lock fd does not conflict with WriteFile on\n  ** cs->pFile (a different HANDLE to the same path).  On Windows,\n  ** exclusive byte-range locks block writes from other handles to the\n  ** locked region even within the same process. */\n  static int csMakeLockPath(const char *path, char **ppLock){\n    int n = (int)strlen(path);\n    char *p = (char *)malloc(n + 6);\n    if( !p ) return -1;\n    memcpy(p, path, n);\n    memcpy(p + n, ".lock", 6);\n    *ppLock = p;\n    return 0;\n  }\n  static int csFileLock(const char *path, int *pFd){\n    char *lockPath = 0;\n    int fd;\n    if( csMakeLockPath(path, &lockPath) ) return -1;\n    fd = _open(lockPath, _O_BINARY | _O_RDWR | _O_CREAT, 0644);\n    free(lockPath);\n    if( fd < 0 ) return -1;\n    {\n      HANDLE h = (HANDLE)_get_osfhandle(fd);\n      OVERLAPPED ov = {0};\n      if( !LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK, 0, MAXDWORD, MAXDWORD, &ov) ){\n        _close(fd);\n        return -1;\n      }\n    }\n    *pFd = fd;\n    return 0;\n  }\n  static void csFileUnlock(int fd){\n    if( fd >= 0 ){\n      HANDLE h = (HANDLE)_get_osfhandle(fd);\n      OVERLAPPED ov = {0};\n      UnlockFileEx(h, 0, MAXDWORD, MAXDWORD, &ov);\n      _close(fd);\n    }\n  }\n  static int csFileLockNB(const char *path, int *pFd){\n    char *lockPath = 0;\n    int fd;\n    if( csMakeLockPath(path, &lockPath) ) return -1;\n    fd = _open(lockPath, _O_BINARY | _O_RDWR | _O_CREAT, 0644);\n    free(lockPath);\n    if( fd < 0 ) return -1;\n    {\n      HANDLE h = (HANDLE)_get_osfhandle(fd);\n      OVERLAPPED ov = {0};\n      if( !LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,\n                       0, MAXDWORD, MAXDWORD, &ov) ){\n        _close(fd);\n        return -1;\n      }\n    }\n    *pFd = fd;\n    return 0;\n  }\n#else`,
      ],
    ],
  },
]

// Build a map from basename → rename pairs for fast lookup.
const patchMap = new Map()
for (const { file, renames } of FILE_PATCHES) {
  patchMap.set(file, renames)
}

// Build a map from basename → text patches for fast lookup.
const textPatchMap = new Map()
for (const { file, patches } of FILE_TEXT_PATCHES) {
  textPatchMap.set(file, patches)
}

function applyRenames(src, renames) {
  let out = src
  for (const [from, to] of renames) {
    // Word-boundary replacement: only replace complete identifiers.
    const re = new RegExp(`\\b${from}\\b`, "g")
    out = out.replace(re, to)
  }
  return out
}

function applyTextPatches(src, patches) {
  let out = src
  for (const [from, to] of patches) {
    if (!out.includes(from)) {
      process.stderr.write(`build-amalgamation: warning — text patch not found in source\n  expected: ${JSON.stringify(from.slice(0, 60))}\n`)
    }
    out = out.split(from).join(to)
  }
  return out
}

if (!fs.existsSync(baseSqlite)) {
  console.error(`build-amalgamation: ${baseSqlite} not found — run download.js first`)
  process.exit(1)
}

console.log("Building full doltlite amalgamation...")

// Extract generated headers (parse.h, opcodes.h) from the sqlite3.c amalgamation.
// These files are produced by the SQLite build system and are not shipped in the tarball.
{
  const base = fs.readFileSync(baseSqlite, "utf8")
  for (const hdr of ["parse.h", "opcodes.h"]) {
    const hdrPath = path.join(srcDir, hdr)
    if (fs.existsSync(hdrPath)) continue
    const beginMark = `/************** Begin file ${hdr}`
    const endMark   = `/************** End of ${hdr}`
    const bi = base.indexOf(beginMark)
    const ei = base.indexOf(endMark)
    if (bi !== -1 && ei !== -1) {
      const startOfContent = base.indexOf("\n", bi) + 1
      const endOfContent   = base.lastIndexOf("\n", ei) + 1
      fs.writeFileSync(hdrPath, base.slice(startOfContent, endOfContent))
      console.log(`Extracted ${hdr} to ${hdrPath}`)
    } else {
      process.stderr.write(`build-amalgamation: warning — could not find ${hdr} in sqlite3.c\n`)
    }
  }
}

// Patch btreeInt.h to add include guards.
// The original file has none; when multiple _orig.c files (each of which does
// #include "btmutex.c" / "backup.c" / etc.) are merged into a single translation
// unit, the compiler re-includes btreeInt.h through each of them, triggering
// struct redefinition errors.
{
  const btreeIntPath = path.join(srcDir, "btreeInt.h")
  if (fs.existsSync(btreeIntPath)) {
    const src = fs.readFileSync(btreeIntPath, "utf8")
    if (!src.includes("#ifndef BTREEINT_H")) {
      fs.writeFileSync(btreeIntPath,
        "#ifndef BTREEINT_H\n#define BTREEINT_H\n" + src + "\n#endif /* BTREEINT_H */\n"
      )
      console.log("Patched btreeInt.h with include guards")
    }
  }
}

// ── doltlite_orig.c ────────────────────────────────────────────────────────
// Compile the original SQLite btree/pager/wal/backup with orig_ prefix symbols.
// This must be a separate TU because it defines the original BtShared / Pager
// structs, which conflict with prolly_btree.c's replacements in doltlite.c.
{
  const origFiles = [
    "btmutex_orig.c",
    "pager_orig.c",
    "wal_orig.c",
    "backup_orig.c",
    "btree_orig.c",
    "btree_orig_api.c",
  ]

  // Variables defined in the original pager/btree code that pager_shim.c in
  // doltlite.c also defines.  We rename them here so the linker sees two
  // different symbols and doesn't complain about duplicate definitions.
  // (These are test/statistics counters, only incremented under #ifdef SQLITE_TEST,
  // so renaming them away from their original names has no runtime effect in
  // release builds.)
  const conflictingGlobals = [
    "sqlite3_pager_readdb_count",
    "sqlite3_pager_writedb_count",
    "sqlite3_pager_writej_count",
    "sqlite3_opentemp_count",
    "sqlite3SharedCacheList",
  ]

  const origLines = [
    "/* Generated by build-amalgamation.js — DO NOT EDIT */",
    "/* Original SQLite btree/pager/wal/backup compiled with orig_ prefix symbols.",
    "** Compiled as a separate translation unit from doltlite.c. */",
    "",
    "/* btree_orig_api.c needs DOLTLITE_PROLLY */",
    "#ifndef DOLTLITE_PROLLY",
    "#define DOLTLITE_PROLLY 1",
    "#endif",
    "",
    "/* Rename globals that pager_shim.c in doltlite.c also defines, to avoid",
    "** duplicate-symbol linker errors in release (non-SQLITE_TEST) builds. */",
    ...conflictingGlobals.map(g => `#define ${g} dlt_orig_${g.replace(/^sqlite3_?/, "")}`),
    "",
  ]

  for (const f of origFiles) {
    const p = path.join(srcDir, f)
    if (!fs.existsSync(p)) {
      process.stderr.write(`build-amalgamation: warning — ${f} not found, skipping\n`)
      continue
    }
    origLines.push(`/************** Begin doltlite_orig file ${f} **************/`)
    origLines.push(fs.readFileSync(p, "utf8"))
    origLines.push(`/************** End of doltlite_orig file ${f} ******************/`)
    origLines.push("")
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outOrig, origLines.join("\n"))
  console.log(`doltlite_orig.c written to ${outOrig}`)
}

// ── doltlite.c ────────────────────────────────────────────────────────────
let content = fs.readFileSync(baseSqlite, "utf8")

// Make SQLITE_PRIVATE symbols non-static so doltlite_orig.c (a separate TU
// that contains the original pager/btree/wal code) can link against them.
// The amalgamation defines SQLITE_PRIVATE as `static`, which gives every
// internal function internal linkage — invisible to other TUs.  Removing
// the `static` makes them hidden-visibility globals (via -fvisibility=hidden)
// that are linkable within the final .node binary but not exported from it.
content = content.replace(/#\s*define\s+SQLITE_PRIVATE\s+static\b/, '# define SQLITE_PRIVATE')

// Wrap each guarded section.
// The amalgamation uses markers of the form:
//   /************** Begin file btree.c **************/
//   /************** End of btree.c ******************/
for (const file of GUARDED) {
  const escapedFile = file.replace(".", "\\.")
  const beginRe = new RegExp(`(/\\*{6,}\\s*Begin file ${escapedFile}\\s*\\*{6,}/)`)
  const endRe   = new RegExp(`(/\\*{6,}\\s*End of ${escapedFile}\\s*\\*{6,}/)`)
  const bm = beginRe.exec(content)
  const em = endRe.exec(content)
  if (!bm || !em) {
    process.stderr.write(`build-amalgamation: warning — markers not found for ${file}\n`)
    continue
  }
  const before  = content.slice(0, bm.index)
  const section = content.slice(bm.index, em.index + em[0].length)
  const after   = content.slice(em.index + em[0].length)
  content = `${before}#ifndef DOLTLITE_PROLLY\n${section}\n#endif /* !DOLTLITE_PROLLY */\n${after}`
}

// Append prolly + doltlite source files.
const parts = [content]
for (const file of EXTRA) {
  const p = path.isAbsolute(file) ? file : path.join(srcDir, file)
  const name = path.basename(p)
  if (!fs.existsSync(p)) {
    process.stderr.write(`build-amalgamation: warning — ${name} not found, skipping\n`)
    continue
  }
  let src = fs.readFileSync(p, "utf8")
  if (patchMap.has(name)) {
    src = applyRenames(src, patchMap.get(name))
  }
  if (textPatchMap.has(name)) {
    src = applyTextPatches(src, textPatchMap.get(name))
  }
  parts.push(`\n/************** Begin DOLTLITE-EXTRA file ${name} **************/\n`)
  parts.push(src)
  parts.push(`\n/************** End of DOLTLITE-EXTRA ${name} ******************/\n`)
}

// Prepend the DOLTLITE_VERSION define into the extra section so that
// prolly_btree.c and doltlite.c can use it without compiler flag quoting issues.
parts.splice(1, 0, `\n/* Injected by build-amalgamation.js */\n#ifndef DOLTLITE_VERSION\n#define DOLTLITE_VERSION "${version}"\n#endif\n`)

// sqlite3PagerWalSystemErrno is defined in pager.c, which is skipped in
// DOLTLITE_PROLLY builds.  pager_shim.c does not implement it.  Provide a
// stub: shim-pagers have no WAL (return 0); plain-sqlite Pagers (from ATTACH)
// dispatch to the orig_ version compiled in doltlite_orig.c.
// strncasecmp is a POSIX extension absent from MSVC — map it to _strnicmp.
parts.push(`
#ifdef DOLTLITE_PROLLY
#ifdef _WIN32
#  ifndef strncasecmp
#    define strncasecmp _strnicmp
#  endif
#endif
extern int orig_sqlite3PagerWalSystemErrno(Pager *pPager);
int sqlite3PagerWalSystemErrno(Pager *pPager){
  if( !pPager ) return 0;
  /* Shim pagers start with PAGER_SHIM_MAGIC (0x50534D31) at offset 0. */
  if( ((const unsigned int*)pPager)[0] == 0x50534D31u ) return 0;
  return orig_sqlite3PagerWalSystemErrno(pPager);
}
#endif /* DOLTLITE_PROLLY */
`)

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outFile, parts.join(""))
console.log(`Amalgamation written to ${outFile}`)

// Generate a shim doltlite_internal.h in the output directory.
// Since amalgamation/ is listed first in include_dirs, this takes priority
// over the one in doltlite-src/src/.  It wraps the definitions that
// prolly_btree.c already provides so they don't get redefined.
const origInternal = fs.readFileSync(
  path.join(srcDir, "doltlite_internal.h"), "utf8"
)
// prolly_btree.c (compiled earlier in the same TU) already defines:
//   struct TableEntry, typedef/struct SchemaEntry, tableEntryNameCmp
// Wrap those in #ifndef DOLTLITE_PROLLY so they're skipped in prolly mode.
let shimInternal = origInternal

// Guard `struct TableEntry { ... };`
shimInternal = shimInternal.replace(
  /(struct TableEntry \{[^}]*\};)/s,
  "#ifndef DOLTLITE_PROLLY\n$1\n#endif /* !DOLTLITE_PROLLY */"
)

// Guard `typedef struct SchemaEntry SchemaEntry;`
shimInternal = shimInternal.replace(
  /typedef struct SchemaEntry SchemaEntry;/,
  "#ifndef DOLTLITE_PROLLY\ntypedef struct SchemaEntry SchemaEntry;\n#endif /* !DOLTLITE_PROLLY */"
)

// Guard `struct SchemaEntry { ... };` (at end of file)
shimInternal = shimInternal.replace(
  /(struct SchemaEntry \{[^}]*\};)/s,
  "#ifndef DOLTLITE_PROLLY\n$1\n#endif /* !DOLTLITE_PROLLY */"
)

// Guard `tableEntryNameCmp` static inline function
shimInternal = shimInternal.replace(
  /(static SQLITE_INLINE int tableEntryNameCmp\([\s\S]*?\n\})/,
  "#ifndef DOLTLITE_PROLLY\n$1\n#endif /* !DOLTLITE_PROLLY */"
)

const shimPath = path.join(outDir, "doltlite_internal.h")
fs.writeFileSync(shimPath, shimInternal)

// Copy the header alongside.
const baseHeader = path.join(srcRoot, "sqlite3.h")
if (fs.existsSync(baseHeader) && !fs.existsSync(outHeader)) {
  fs.copyFileSync(baseHeader, outHeader)
}

console.log(`Shim doltlite_internal.h written to ${shimPath}`)

// Copy all .h files from doltlite-src/src/ and doltlite-src/ext/blake3/ into
// amalgamation/ so the compiler can find them via the existing "amalgamation"
// include_dir without needing doltlite-src in the C include path.
// Skip files that already have custom shims (btreeInt.h, doltlite_internal.h).
const SKIP_HEADERS = new Set(["btreeInt.h", "doltlite_internal.h"])
for (const hdrDir of [srcRoot, srcDir, blake3Dir]) {
  if (!fs.existsSync(hdrDir)) continue
  for (const f of fs.readdirSync(hdrDir)) {
    if (!f.endsWith(".h") || SKIP_HEADERS.has(f)) continue
    const dest = path.join(outDir, f)
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(path.join(hdrDir, f), dest)
    }
  }
}

// The _orig.c wrapper files each textually #include their base SQLite .c file
// (e.g. btmutex_orig.c does #include "btmutex.c").  When those wrappers are
// inlined into doltlite_orig.c the compiler resolves the include relative to
// amalgamation/, so the base .c files must be present there too.
for (const f of ["btmutex.c", "pager.c", "wal.c", "backup.c", "btree.c"]) {
  const src = path.join(srcDir, f)
  const dest = path.join(outDir, f)
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    fs.copyFileSync(src, dest)
  }
}

// Generate amalgamation/btreeInt.h — adds include guards that the original lacks.
// Without guards, each _orig.c file in doltlite_orig.c re-includes btreeInt.h via
// sqliteInt.h, causing struct redefinition errors in a single translation unit.
// The shim must NOT have its own #ifndef BTREEINT_H guard: we already patch the
// original btreeInt.h to add that guard, so if the shim defined it first the
// original's body would be skipped and struct Btree would never be declared.
const btreeIntShim = [
  "/* Generated by build-amalgamation.js — DO NOT EDIT */",
  "/* Redirects to doltlite-src/src/btreeInt.h (which has its own include guard). */",
  `#include "../doltlite-src/src/btreeInt.h"`,
  "",
].join("\n")
fs.writeFileSync(path.join(outDir, "btreeInt.h"), btreeIntShim)
console.log(`Shim btreeInt.h written to ${path.join(outDir, "btreeInt.h")}`)

// Generate SIMD wrapper files for BLAKE3.
//
// SSE4.1, AVX2, and AVX-512 are disabled via BLAKE3_NO_* defines in binding.gyp
// because they require per-file compiler flags that GYP can't express portably.
// SSE2 (baseline on x86_64) and NEON (baseline on aarch64) need no special flags
// and are compiled here as separate translation units.
const simdWrappers = [
  // name in amalgamation/    source file       arch guard
  ["blake3_sse2_impl.c",  "blake3_sse2.c",  "defined(__x86_64__)||defined(_M_X64)||defined(__i386__)"],
  ["blake3_neon_impl.c",  "blake3_neon.c",  "defined(__aarch64__)||defined(__arm__)"],
]

for (const [wrapName, srcName, archGuard] of simdWrappers) {
  const srcPath = path.join(blake3Dir, srcName)
  if (!fs.existsSync(srcPath)) continue
  const relSrc = path.relative(outDir, srcPath).replace(/\\/g, "/")
  const lines = [
    "/* Generated by build-amalgamation.js — DO NOT EDIT */",
    `#if ${archGuard}`,
    `#include "${relSrc}"`,
    "#endif",
    "",
  ]
  fs.writeFileSync(path.join(outDir, wrapName), lines.join("\n"))
  console.log(`SIMD wrapper ${wrapName} written`)
}
