#pragma once
#include <memory>
#include <napi.h>
#include "doltlite.h"

struct DatabaseConnection;

class Statement : public Napi::ObjectWrap<Statement> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  Statement(const Napi::CallbackInfo& info);
  ~Statement();

  static Napi::Object Create(Napi::Env env, const std::shared_ptr<DatabaseConnection>& connection,
                             sqlite3_stmt* stmt);

private:
  friend class Database;
  void FinalizeStatement();

  sqlite3_stmt* stmt_ = nullptr;
  std::shared_ptr<DatabaseConnection> connection_;
  std::string source_;
  uint64_t generation_ = 0;
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
