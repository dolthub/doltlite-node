#pragma once
#include <napi.h>
#include "doltlite.h"

class Database;

class Statement : public Napi::ObjectWrap<Statement> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  Statement(const Napi::CallbackInfo& info);
  ~Statement();

  static Napi::Object Create(Napi::Env env, Database* db, sqlite3_stmt* stmt);

private:
  sqlite3_stmt* stmt_ = nullptr;
  Database* db_ = nullptr;
  std::string source_;
  bool returnArrays_ = false;
  bool readBigInts_ = false;
  bool allowBareNamedParameters_ = true;
  bool allowUnknownNamedParameters_ = false;

  Napi::Value Run(const Napi::CallbackInfo& info);
  Napi::Value Get(const Napi::CallbackInfo& info);
  Napi::Value All(const Napi::CallbackInfo& info);
  Napi::Value Iterate(const Napi::CallbackInfo& info);
  Napi::Value Columns(const Napi::CallbackInfo& info);
  Napi::Value SetReturnArrays(const Napi::CallbackInfo& info);
  Napi::Value SetReadBigInts(const Napi::CallbackInfo& info);
  Napi::Value SetAllowBareNamedParameters(const Napi::CallbackInfo& info);
  Napi::Value SetAllowUnknownNamedParameters(const Napi::CallbackInfo& info);
  Napi::Value SourceSQLGetter(const Napi::CallbackInfo& info);
  Napi::Value ExpandedSQLGetter(const Napi::CallbackInfo& info);

  static Napi::FunctionReference& GetConstructor(Napi::Env env);
};
