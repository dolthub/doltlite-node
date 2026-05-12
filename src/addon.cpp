#include "database.h"
#include "statement.h"

extern "C" int doltliteInstallAutoExt(void);

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  doltliteInstallAutoExt();
  // StatementSync must be initialised first so its constructor_ is set before
  // Database::Prepare() can call Statement::Create().
  Statement::Init(env, exports);
  Database::Init(env, exports);
  return exports;
}

NODE_API_MODULE(doltlite, Init)

// C-linkage entry point used by src/bun_compat.cpp.
extern "C" napi_value _doltlite_init(napi_env env, napi_value exports) {
  return Init(Napi::Env(env), Napi::Object(env, exports));
}
