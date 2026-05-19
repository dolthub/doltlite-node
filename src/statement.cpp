#include "statement.h"
#include "database.h"
#include "util.h"
#include <vector>

// Per-env storage for the Statement constructor so re-loading in a Worker
// thread doesn't overwrite the main thread's constructor reference.
struct StatementEnvData {
  Napi::FunctionReference constructor;
};

Napi::FunctionReference& Statement::GetConstructor(Napi::Env env) {
  auto* data = env.GetInstanceData<StatementEnvData>();
  return data->constructor;
}

// ── Factory (called from Database::Prepare) ──────────────────────────────────

Napi::Object Statement::Create(Napi::Env env, Database* db, sqlite3_stmt* stmt) {
  auto obj = GetConstructor(env).New({});
  auto* self = Napi::ObjectWrap<Statement>::Unwrap(obj);
  self->db_ = db;
  self->stmt_ = stmt;
  self->source_ = sqlite3_sql(stmt) ? sqlite3_sql(stmt) : "";
  return obj;
}

// ── Constructor (called via new StatementSync internally) ─────────────────────

Statement::Statement(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<Statement>(info) {}

Statement::~Statement() {
  if (stmt_) { sqlite3_finalize(stmt_); stmt_ = nullptr; }
}

// ── run() → {changes, lastInsertRowid} ───────────────────────────────────────

Napi::Value Statement::Run(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!stmt_) { Napi::Error::New(env, "Statement is finalised").ThrowAsJavaScriptException(); return env.Undefined(); }
  if (!BindArgs(env, stmt_, info, 0, allowBareNamedParameters_,
                allowUnknownNamedParameters_)) return env.Undefined();

  int rc = sqlite3_step(stmt_);
  sqlite3_reset(stmt_);

  if (rc != SQLITE_DONE && rc != SQLITE_ROW) {
    ThrowSQLiteError(env, db_->Handle(), "run"); return env.Undefined();
  }

  auto result = Napi::Object::New(env);
  result.Set("changes", Napi::Number::New(env, sqlite3_changes(db_->Handle())));
  result.Set("lastInsertRowid",
             Napi::Number::New(env, (double)sqlite3_last_insert_rowid(db_->Handle())));
  return result;
}

// ── get() → object | undefined ───────────────────────────────────────────────

Napi::Value Statement::Get(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!stmt_) { Napi::Error::New(env, "Statement is finalised").ThrowAsJavaScriptException(); return env.Undefined(); }
  if (!BindArgs(env, stmt_, info, 0, allowBareNamedParameters_,
                allowUnknownNamedParameters_)) return env.Undefined();

  int rc = sqlite3_step(stmt_);
  Napi::Value result = env.Undefined();
  if (rc == SQLITE_ROW) {
    result = returnArrays_ ? (Napi::Value)RowToArray(env, stmt_, readBigInts_)
                           : (Napi::Value)RowToObject(env, stmt_, readBigInts_);
  }
  else if (rc != SQLITE_DONE) ThrowSQLiteError(env, db_->Handle(), "get");
  sqlite3_reset(stmt_);
  return result;
}

// ── all() → object[] ─────────────────────────────────────────────────────────

Napi::Value Statement::All(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!stmt_) { Napi::Error::New(env, "Statement is finalised").ThrowAsJavaScriptException(); return env.Undefined(); }
  if (!BindArgs(env, stmt_, info, 0, allowBareNamedParameters_,
                allowUnknownNamedParameters_)) return env.Undefined();

  auto result = Napi::Array::New(env);
  uint32_t idx = 0;
  int rc;
  while ((rc = sqlite3_step(stmt_)) == SQLITE_ROW)
    result.Set(idx++, returnArrays_ ? (Napi::Value)RowToArray(env, stmt_, readBigInts_)
                                    : (Napi::Value)RowToObject(env, stmt_, readBigInts_));
  sqlite3_reset(stmt_);
  if (rc != SQLITE_DONE) ThrowSQLiteError(env, db_->Handle(), "all");
  return result;
}

// ── node:sqlite compatibility flags ──────────────────────────────────────────

Napi::Value Statement::SetReturnArrays(const Napi::CallbackInfo& info) {
  returnArrays_ = info.Length() > 0 && info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

Napi::Value Statement::SetReadBigInts(const Napi::CallbackInfo& info) {
  readBigInts_ = info.Length() > 0 && info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

Napi::Value Statement::SetAllowBareNamedParameters(const Napi::CallbackInfo& info) {
  allowBareNamedParameters_ = info.Length() > 0 && info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

Napi::Value Statement::SetAllowUnknownNamedParameters(const Napi::CallbackInfo& info) {
  allowUnknownNamedParameters_ = info.Length() > 0 && info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

// ── iterate() → IterableIterator ─────────────────────────────────────────────
// Returns a plain JS iterator object: { next() { return {value, done} } }
// A full Symbol.iterator implementation requires a persistent Napi::Reference
// to the stmt; for simplicity we materialise all rows eagerly here and return
// an iterator over the resulting array. Callers that need true lazy iteration
// can use a prepared statement loop directly.

Napi::Value Statement::Iterate(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // Materialise all rows then hand back a JS iterator over them.
  auto all = All(info);
  if (env.IsExceptionPending()) return env.Undefined();

  auto arr = all.As<Napi::Array>();
  auto idxRef = std::make_shared<uint32_t>(0);
  uint32_t len = arr.Length();

  // Build a persistent reference so the closure keeps the array alive.
  auto arrRef = std::make_shared<Napi::Reference<Napi::Array>>(
      Napi::Persistent(arr));

  auto nextFn = Napi::Function::New(env, [arrRef, idxRef, len](const Napi::CallbackInfo& cb) -> Napi::Value {
    Napi::Env e = cb.Env();
    auto obj = Napi::Object::New(e);
    if (*idxRef >= len) {
      obj.Set("done",  Napi::Boolean::New(e, true));
      obj.Set("value", e.Undefined());
    } else {
      obj.Set("done",  Napi::Boolean::New(e, false));
      obj.Set("value", arrRef->Value().Get(*idxRef));
      (*idxRef)++;
    }
    return obj;
  });

  auto iter = Napi::Object::New(env);
  iter.Set("next", nextFn);
  // Make the iterator itself iterable (Symbol.iterator returns this).
  auto selfFn = Napi::Function::New(env, [](const Napi::CallbackInfo& cb) -> Napi::Value {
    return cb.This();
  });
  iter.Set(Napi::Symbol::WellKnown(env, "iterator"), selfFn);
  return iter;
}

// ── columns() ────────────────────────────────────────────────────────────────

Napi::Value Statement::Columns(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!stmt_) { Napi::Error::New(env, "Statement is finalised").ThrowAsJavaScriptException(); return env.Undefined(); }
  int n = sqlite3_column_count(stmt_);
  auto result = Napi::Array::New(env, n);
  for (int i = 0; i < n; i++) {
    auto col = Napi::Object::New(env);
    const char* name   = sqlite3_column_name(stmt_, i);
    const char* origin = sqlite3_column_origin_name(stmt_, i);
    const char* tbl    = sqlite3_column_table_name(stmt_, i);
    const char* db     = sqlite3_column_database_name(stmt_, i);
    const char* type   = sqlite3_column_decltype(stmt_, i);
    col.Set("name",     name   ? Napi::String::New(env, name)   : env.Null());
    col.Set("column",   origin ? Napi::String::New(env, origin) : env.Null());
    col.Set("table",    tbl    ? Napi::String::New(env, tbl)    : env.Null());
    col.Set("database", db     ? Napi::String::New(env, db)     : env.Null());
    col.Set("type",     type   ? Napi::String::New(env, type)   : env.Null());
    result.Set(i, col);
  }
  return result;
}

// ── sourceSQL / expandedSQL properties ───────────────────────────────────────

Napi::Value Statement::SourceSQLGetter(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), source_);
}

Napi::Value Statement::ExpandedSQLGetter(const Napi::CallbackInfo& info) {
  if (!stmt_) return Napi::String::New(info.Env(), source_);
  char* expanded = sqlite3_expanded_sql(stmt_);
  std::string s = expanded ? expanded : source_;
  if (expanded) sqlite3_free(expanded);
  return Napi::String::New(info.Env(), s);
}

// ── Class registration ───────────────────────────────────────────────────────

Napi::Object Statement::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function ctor = DefineClass(env, "StatementSync", {
    InstanceMethod("run",                             &Statement::Run),
    InstanceMethod("get",                             &Statement::Get),
    InstanceMethod("all",                             &Statement::All),
    InstanceMethod("iterate",                         &Statement::Iterate),
    InstanceMethod("columns",                         &Statement::Columns),
    InstanceMethod("setReturnArrays",                 &Statement::SetReturnArrays),
    InstanceMethod("setReadBigInts",                  &Statement::SetReadBigInts),
    InstanceMethod("setAllowBareNamedParameters",     &Statement::SetAllowBareNamedParameters),
    InstanceMethod("setAllowUnknownNamedParameters",  &Statement::SetAllowUnknownNamedParameters),
    InstanceAccessor("sourceSQL",   &Statement::SourceSQLGetter,   nullptr),
    InstanceAccessor("expandedSQL", &Statement::ExpandedSQLGetter, nullptr),
  });
  auto* data = new StatementEnvData();
  data->constructor = Napi::Persistent(ctor);
  data->constructor.SuppressDestruct();
  env.SetInstanceData<StatementEnvData>(data);
  exports.Set("StatementSync", ctor);
  return exports;
}
