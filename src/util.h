#pragma once
#include <napi.h>
#include "doltlite.h"
#include <string>

// Converts a SQLite column value to a Napi::Value.
inline Napi::Value ColumnToNapi(Napi::Env env, sqlite3_stmt* stmt, int col) {
  switch (sqlite3_column_type(stmt, col)) {
    case SQLITE_INTEGER:
      return Napi::Number::New(env, (double)sqlite3_column_int64(stmt, col));
    case SQLITE_FLOAT:
      return Napi::Number::New(env, sqlite3_column_double(stmt, col));
    case SQLITE_TEXT: {
      const char* text = (const char*)sqlite3_column_text(stmt, col);
      int bytes = sqlite3_column_bytes(stmt, col);
      return Napi::String::New(env, text, bytes);
    }
    case SQLITE_BLOB: {
      const void* data = sqlite3_column_blob(stmt, col);
      int bytes = sqlite3_column_bytes(stmt, col);
      auto buf = Napi::Buffer<uint8_t>::Copy(env, (const uint8_t*)data, bytes);
      return buf;
    }
    case SQLITE_NULL:
    default:
      return env.Null();
  }
}

// Builds a JS object from the current row of a prepared statement.
inline Napi::Object RowToObject(Napi::Env env, sqlite3_stmt* stmt) {
  auto obj = Napi::Object::New(env);
  int n = sqlite3_column_count(stmt);
  for (int i = 0; i < n; i++) {
    const char* name = sqlite3_column_name(stmt, i);
    obj.Set(name, ColumnToNapi(env, stmt, i));
  }
  return obj;
}

// Binds a JS value to a prepared statement parameter (1-based index).
inline bool BindNapi(Napi::Env env, sqlite3_stmt* stmt, int idx, Napi::Value val) {
  if (val.IsNull() || val.IsUndefined()) {
    sqlite3_bind_null(stmt, idx);
  } else if (val.IsNumber()) {
    double d = val.As<Napi::Number>().DoubleValue();
    int64_t i = (int64_t)d;
    if ((double)i == d) {
      sqlite3_bind_int64(stmt, idx, i);
    } else {
      sqlite3_bind_double(stmt, idx, d);
    }
  } else if (val.IsString()) {
    std::string s = val.As<Napi::String>().Utf8Value();
    sqlite3_bind_text(stmt, idx, s.c_str(), (int)s.size(), SQLITE_TRANSIENT);
  } else if (val.IsBoolean()) {
    sqlite3_bind_int(stmt, idx, val.As<Napi::Boolean>().Value() ? 1 : 0);
  } else if (val.IsBuffer()) {
    auto buf = val.As<Napi::Buffer<uint8_t>>();
    sqlite3_bind_blob(stmt, idx, buf.Data(), (int)buf.ByteLength(), SQLITE_TRANSIENT);
  } else if (val.IsBigInt()) {
    bool lossless;
    int64_t i = val.As<Napi::BigInt>().Int64Value(&lossless);
    sqlite3_bind_int64(stmt, idx, i);
  } else {
    Napi::TypeError::New(env, "Unsupported parameter type").ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

// Binds JS arguments (array or named object) to a prepared statement.
// positional: bind(val, val, ...) or bind([val, val, ...])
// named: bind({$name: val, ...}) or bare names {name: val} if allowBare=true
inline bool BindArgs(Napi::Env env, sqlite3_stmt* stmt,
                     const Napi::CallbackInfo& info, size_t startIdx = 0,
                     bool allowBare = true) {
  sqlite3_clear_bindings(stmt);
  if (info.Length() <= (int)startIdx) return true;

  // Named parameters via a plain object
  if (info.Length() == startIdx + 1 && info[startIdx].IsObject()
      && !info[startIdx].IsBuffer() && !info[startIdx].IsArray()) {
    auto obj = info[startIdx].As<Napi::Object>();
    auto keys = obj.GetPropertyNames();
    for (uint32_t i = 0; i < keys.Length(); i++) {
      std::string key = keys.Get(i).As<Napi::String>().Utf8Value();
      // Try $name, :name, @name prefixes, then bare if allowBare
      int idx = 0;
      for (const char* prefix : {"", "$", ":", "@"}) {
        std::string k = std::string(prefix) + key;
        idx = sqlite3_bind_parameter_index(stmt, k.c_str());
        if (idx > 0) break;
      }
      if (idx == 0 && !allowBare) continue;
      if (idx == 0) continue;
      if (!BindNapi(env, stmt, idx, obj.Get(keys.Get(i)))) return false;
    }
    return true;
  }

  // Positional parameters
  for (size_t i = startIdx; i < (size_t)info.Length(); i++) {
    int pos = (int)(i - startIdx + 1);
    if (info[i].IsArray()) {
      // bind([v1, v2, ...])
      auto arr = info[i].As<Napi::Array>();
      for (uint32_t j = 0; j < arr.Length(); j++) {
        if (!BindNapi(env, stmt, pos + (int)j, arr.Get(j))) return false;
      }
      break;
    }
    if (!BindNapi(env, stmt, pos, info[i])) return false;
  }
  return true;
}

// Throws a SQLite error as a JS Error.
inline void ThrowSQLiteError(Napi::Env env, sqlite3* db, const char* context = nullptr) {
  std::string msg;
  if (context) { msg += context; msg += ": "; }
  msg += sqlite3_errmsg(db);
  Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}
