#pragma once
#include <napi.h>
#include "doltlite.h"
#include <string>

// Converts a SQLite column value to a Napi::Value.
inline Napi::Value ColumnToNapi(Napi::Env env, sqlite3_stmt* stmt, int col,
                                bool readBigInts = false) {
  switch (sqlite3_column_type(stmt, col)) {
    case SQLITE_INTEGER: {
      sqlite3_int64 i = sqlite3_column_int64(stmt, col);
      if (readBigInts) return Napi::BigInt::New(env, (int64_t)i);
      return Napi::Number::New(env, (double)i);
    }
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
inline Napi::Object RowToObject(Napi::Env env, sqlite3_stmt* stmt,
                                bool readBigInts = false) {
  auto obj = Napi::Object::New(env);
  int n = sqlite3_column_count(stmt);
  for (int i = 0; i < n; i++) {
    const char* name = sqlite3_column_name(stmt, i);
    obj.Set(name, ColumnToNapi(env, stmt, i, readBigInts));
  }
  return obj;
}

// Builds a JS array from the current row of a prepared statement.
inline Napi::Array RowToArray(Napi::Env env, sqlite3_stmt* stmt,
                              bool readBigInts = false) {
  int n = sqlite3_column_count(stmt);
  auto arr = Napi::Array::New(env, n);
  for (int i = 0; i < n; i++) {
    arr.Set((uint32_t)i, ColumnToNapi(env, stmt, i, readBigInts));
  }
  return arr;
}

inline Napi::Error SQLiteError(Napi::Env env, sqlite3* db, int rc,
                              const char* operation, const char* message = nullptr) {
  int extended = db ? sqlite3_extended_errcode(db) : rc;
  int code = (extended & 0xff) == (rc & 0xff) ? extended : rc;
  const char* errstr = sqlite3_errstr(code);
  if (!message) message = db ? sqlite3_errmsg(db) : errstr;
  auto error = Napi::Error::New(env, message);
  error.Set("code", "ERR_SQLITE_ERROR");
  error.Set("errcode", Napi::Number::New(env, code));
  error.Set("errstr", errstr);
  error.Set("operation", operation);
  return error;
}

// Binds a JS value to a prepared statement parameter (1-based index).
inline bool BindNapi(Napi::Env env, sqlite3_stmt* stmt, int idx, Napi::Value val) {
  int rc;
  if (val.IsNull() || val.IsUndefined()) {
    rc = sqlite3_bind_null(stmt, idx);
  } else if (val.IsNumber()) {
    double d = val.As<Napi::Number>().DoubleValue();
    int64_t i = (int64_t)d;
    if ((double)i == d) {
      rc = sqlite3_bind_int64(stmt, idx, i);
    } else {
      rc = sqlite3_bind_double(stmt, idx, d);
    }
  } else if (val.IsString()) {
    std::string s = val.As<Napi::String>().Utf8Value();
    rc = sqlite3_bind_text(stmt, idx, s.c_str(), (int)s.size(), SQLITE_TRANSIENT);
  } else if (val.IsBoolean()) {
    rc = sqlite3_bind_int(stmt, idx, val.As<Napi::Boolean>().Value() ? 1 : 0);
  } else if (val.IsTypedArray()) {
    void* data = nullptr;
    if (napi_get_typedarray_info(env, val, nullptr, nullptr, &data, nullptr, nullptr) != napi_ok) {
      Napi::TypeError::New(env, "Cannot read typed array").ThrowAsJavaScriptException();
      return false;
    }
    rc = sqlite3_bind_blob64(stmt, idx, data ? data : "", val.As<Napi::TypedArray>().ByteLength(), SQLITE_TRANSIENT);
  } else if (val.IsDataView()) {
    auto view = val.As<Napi::DataView>();
    const void* data = view.ByteLength() ? view.Data() : "";
    rc = sqlite3_bind_blob64(stmt, idx, data, view.ByteLength(), SQLITE_TRANSIENT);
  } else if (val.IsBigInt()) {
    bool lossless;
    int64_t i = val.As<Napi::BigInt>().Int64Value(&lossless);
    rc = sqlite3_bind_int64(stmt, idx, i);
  } else {
    Napi::TypeError::New(env, "Unsupported parameter type").ThrowAsJavaScriptException();
    return false;
  }
  if (rc == SQLITE_OK) return true;
  SQLiteError(env, sqlite3_db_handle(stmt), rc, "bind").ThrowAsJavaScriptException();
  return false;
}

// Binds JS arguments (array or named object) to a prepared statement.
// positional: bind(val, val, ...) or bind([val, val, ...])
// named: bind({$name: val, ...}) or bare names {name: val} if allowBare=true
inline bool BindArgs(Napi::Env env, sqlite3_stmt* stmt,
                     const Napi::CallbackInfo& info, size_t startIdx = 0,
                     bool allowBare = true, bool allowUnknown = false) {
  sqlite3_clear_bindings(stmt);
  if (info.Length() <= startIdx) return true;

  // Named parameters via a plain object
  if (info.Length() == startIdx + 1 && info[startIdx].IsObject()
      && !info[startIdx].IsTypedArray() && !info[startIdx].IsDataView()
      && !info[startIdx].IsArray()) {
    auto obj = info[startIdx].As<Napi::Object>();
    auto keys = obj.GetPropertyNames();
    if (env.IsExceptionPending()) return false;
    for (uint32_t i = 0; i < keys.Length(); i++) {
      std::string key = keys.Get(i).As<Napi::String>().Utf8Value();
      int idx = 0;
      if (!key.empty() && (key[0] == '$' || key[0] == ':' || key[0] == '@')) {
        idx = sqlite3_bind_parameter_index(stmt, key.c_str());
      } else if (allowBare) {
        for (const char* prefix : {"$", ":", "@", ""}) {
          std::string k = std::string(prefix) + key;
          idx = sqlite3_bind_parameter_index(stmt, k.c_str());
          if (idx > 0) break;
        }
      }
      if (idx == 0) {
        if (allowUnknown) continue;
        Napi::Error::New(env, "Unknown named parameter '" + key + "'")
            .ThrowAsJavaScriptException();
        return false;
      }
      auto value = obj.Get(key);
      if (env.IsExceptionPending() || !BindNapi(env, stmt, idx, value)) return false;
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
        auto value = arr.Get(j);
        if (env.IsExceptionPending() || !BindNapi(env, stmt, pos + (int)j, value)) return false;
      }
      break;
    }
    if (!BindNapi(env, stmt, pos, info[i])) return false;
  }
  return true;
}
