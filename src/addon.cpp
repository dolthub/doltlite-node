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

// bun's Worker loader requires napi_register_module_v1 regardless of the Node
// version used to compile the addon. In Node 22.22+, NAPI_MODULE already exports
// this symbol, so use weak linkage to avoid a redefinition error while still
// providing the symbol for older Node builds. MSVC has no weak-function support;
// skip it there since Node 22 supplies the symbol via NAPI_MODULE on Windows too.
#if !defined(_MSC_VER)
extern "C" __attribute__((weak)) NAPI_EXTERN napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  return Init(Napi::Env(env), Napi::Object(env, exports));
}
#endif
