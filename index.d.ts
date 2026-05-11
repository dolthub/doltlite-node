/**
 * @dolthub/doltlite — Node.js bindings for DoltLite
 *
 * `DatabaseSync` and `StatementSync` are intentionally compatible with the
 * Node.js built-in `node:sqlite` module so existing consumers can switch by
 * changing their import. Dolt-specific methods are added under `dolt*` names.
 */

/**
 * Absolute path to the platform's `doltlite` CLI binary bundled in this
 * package. Use it to spawn the shell (interactive or with a script piped
 * via stdio). Throws if the binary isn't bundled for the current
 * platform/arch.
 */
export function binPath(): string

export interface ColumnInfo {
  name: string | null
  column: string | null
  table: string | null
  database: string | null
  type: string | null
}

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface MergeResult {
  fast_forward: number
  conflicts: number
}

export interface DoltCommit {
  commit_hash: string
  committer: string
  committer_email: string
  message: string
  date: string
  parents: string
}

export interface DoltBranchInfo {
  name: string
  hash: string
  latest_committer: string
  latest_committer_email: string
  latest_commit_date: string
  latest_commit_message: string
}

export interface DoltStatusEntry {
  table_name: string
  staged: number
  status: string
}

export interface DoltDiffRow {
  from_commit: string
  from_commit_date: string
  to_commit: string
  to_commit_date: string
  diff_type: "added" | "removed" | "modified"
  [column: string]: unknown
}

export interface DoltTagInfo {
  tag_name: string
  tag_hash: string
  tagger: string
  tagger_email: string
  date: string
  message: string
}

export interface DatabaseSyncOptions {
  /** Open the database immediately (default: true). */
  open?: boolean
  /** Open in read-only mode (default: false). */
  readOnly?: boolean
}

export class StatementSync {
  /** Execute the statement and return change metadata. */
  run(...params: unknown[]): RunResult
  /** Return the first result row, or undefined. */
  get(...params: unknown[]): Record<string, unknown> | undefined
  /** Return all result rows. */
  all(...params: unknown[]): Record<string, unknown>[]
  /** Return an iterator over result rows. */
  iterate(...params: unknown[]): IterableIterator<Record<string, unknown>>
  /** Return column metadata for the statement. */
  columns(): ColumnInfo[]
  /** The SQL source text of the statement. */
  readonly sourceSQL: string
  /** The SQL text with bound parameters expanded. */
  readonly expandedSQL: string
}

export class DatabaseSync {
  constructor(path: string, options?: DatabaseSyncOptions)

  // ── node:sqlite-compatible API ──────────────────────────────────────────

  /** Execute one or more SQL statements (no result returned). */
  exec(sql: string): void
  /** Compile a SQL statement for repeated execution. */
  prepare(sql: string): StatementSync
  /** Close the database connection. */
  close(): void
  /** (Re-)open the database at the given path. */
  open(path: string): void
  /** Return the filesystem path of the database, or null for :memory:. */
  location(): string | null
  /** Register a user-defined scalar SQL function. */
  createFunction(name: string, fn: (...args: unknown[]) => unknown): void

  /** True if the database connection is open. */
  readonly isOpen: boolean
  /** True if a transaction is currently active. */
  readonly inTransaction: boolean

  // ── Dolt version-control API ────────────────────────────────────────────

  /**
   * Stage all modified tables and create a commit.
   * Returns the new commit hash.
   */
  doltCommit(message: string): string

  /**
   * Create a new branch, optionally from a specific source branch.
   */
  doltBranch(name: string, fromBranch?: string): void

  /** Check out an existing branch. */
  doltCheckout(branch: string): void

  /**
   * Merge a branch into HEAD.
   * Returns `{fast_forward, conflicts}`.
   */
  doltMerge(branch: string): MergeResult

  /** Reset HEAD. Pass `"--hard"` for a hard reset. */
  doltReset(flag?: "--hard"): void

  /** Return the working-set status (staged/unstaged changes). */
  doltStatus(): DoltStatusEntry[]

  /** Return commit history, newest first. */
  doltLog(options?: { limit?: number }): DoltCommit[]

  /** Return all branches. */
  doltBranches(): DoltBranchInfo[]

  /** Return the name of the currently active branch. */
  doltActiveBranch(): string

  /**
   * Stage a table (or all tables if no argument) for the next commit.
   */
  doltAdd(table?: string): void

  /**
   * Return row-level diff between two refs for a given table.
   */
  doltDiff(fromRef: string, toRef: string, table: string): DoltDiffRow[]

  /** Return the content hash of the database at a ref (default: HEAD). */
  doltHashOf(ref?: string): string

  /** Return the DoltLite version string. */
  doltVersion(): string

  /** Create a tag at HEAD. */
  doltTag(name: string): void

  /** Return all tags. */
  doltTags(): DoltTagInfo[]

  /**
   * Return the full history of rows in a table across all commits.
   * Equivalent to `SELECT * FROM dolt_history_<table>`.
   */
  doltHistoryOf(table: string): Record<string, unknown>[]

  /**
   * Return blame information for a table — which commit last modified each row.
   * Equivalent to `SELECT * FROM dolt_blame_<table>`.
   */
  doltBlameOf(table: string): Record<string, unknown>[]

  /** Cherry-pick a commit onto HEAD. */
  doltCherryPick(commitHash: string): void

  /** Revert a commit (default: HEAD). */
  doltRevert(ref?: string): void
}
