#pragma once
#include <napi.h>
#include "doltlite.h"
#include <memory>
#include <string>
#include <unordered_set>

class Statement;

struct DatabaseConnection {
  ~DatabaseConnection() { sqlite3_close_v2(db); }

  class StatementUse {
  public:
    explicit StatementUse(DatabaseConnection& connection) : connection_(connection) {
      ++connection_.activeStatements;
    }
    ~StatementUse() { --connection_.activeStatements; }

  private:
    DatabaseConnection& connection_;
  };

  sqlite3* db = nullptr;
  std::unordered_set<Statement*> statements;
  unsigned activeStatements = 0;
};

class Database : public Napi::ObjectWrap<Database> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  explicit Database(const Napi::CallbackInfo& info);

private:
  sqlite3* Handle() const { return connection_->db; }
  std::shared_ptr<DatabaseConnection> connection_ = std::make_shared<DatabaseConnection>();
  std::string path_;

  // node:sqlite-compatible methods
  Napi::Value Exec(const Napi::CallbackInfo& info);
  Napi::Value Prepare(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);
  Napi::Value Open(const Napi::CallbackInfo& info);
  Napi::Value IsOpenGetter(const Napi::CallbackInfo& info);
  Napi::Value IsTransactionGetter(const Napi::CallbackInfo& info);
  Napi::Value Location(const Napi::CallbackInfo& info);
  Napi::Value CreateFunction(const Napi::CallbackInfo& info);

  // Dolt version-control helpers (thin SQL wrappers)
  Napi::Value DoltCommit(const Napi::CallbackInfo& info);
  Napi::Value DoltBranch(const Napi::CallbackInfo& info);
  Napi::Value DoltCheckout(const Napi::CallbackInfo& info);
  Napi::Value DoltMerge(const Napi::CallbackInfo& info);
  Napi::Value DoltReset(const Napi::CallbackInfo& info);
  Napi::Value DoltStatus(const Napi::CallbackInfo& info);
  Napi::Value DoltLog(const Napi::CallbackInfo& info);
  Napi::Value DoltBranches(const Napi::CallbackInfo& info);
  Napi::Value DoltActiveBranch(const Napi::CallbackInfo& info);
  Napi::Value DoltAdd(const Napi::CallbackInfo& info);
  Napi::Value DoltDiff(const Napi::CallbackInfo& info);
  Napi::Value DoltHashOf(const Napi::CallbackInfo& info);
  Napi::Value DoltVersion(const Napi::CallbackInfo& info);
  Napi::Value DoltTag(const Napi::CallbackInfo& info);
  Napi::Value DoltTags(const Napi::CallbackInfo& info);
  Napi::Value DoltHistoryOf(const Napi::CallbackInfo& info);
  Napi::Value DoltBlameOf(const Napi::CallbackInfo& info);
  Napi::Value DoltCherryPick(const Napi::CallbackInfo& info);
  Napi::Value DoltRevert(const Napi::CallbackInfo& info);

  // Internal helpers
  Napi::Array ExecQuery(Napi::Env env, const std::string& sql,
                        const std::vector<std::string>& params = {});
  std::string ExecScalar(Napi::Env env, const std::string& sql,
                         const std::vector<std::string>& params = {});
};
