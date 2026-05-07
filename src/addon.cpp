#include "database.h"
#include "statement.h"

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // StatementSync must be initialised first so its constructor_ is set before
  // Database::Prepare() can call Statement::Create().
  Statement::Init(env, exports);
  Database::Init(env, exports);
  return exports;
}

NODE_API_MODULE(doltlite, Init)
