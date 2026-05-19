#include <node_api.h>

// Forward declaration of the init function defined in addon.cpp.
extern "C" napi_value _doltlite_init(napi_env env, napi_value exports);

// Provide napi_register_module_v1 for Bun's Worker loader on Node builds where
// NAPI_MODULE uses constructor registration and doesn't export this symbol
// (Node < ~22.12). On newer Node builds, NODE_API_MODULE in addon.cpp already
// emits a strong napi_register_module_v1, which the linker will prefer over
// this weak definition. MSVC doesn't support weak functions; skip it there
// since Windows builds target Node 22+ which supplies the symbol via NAPI_MODULE.
#if !defined(_MSC_VER)
extern "C" __attribute__((weak, visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  return _doltlite_init(env, exports);
}
#endif
