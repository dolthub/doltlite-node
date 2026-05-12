{
  "targets": [
    {
      "target_name": "doltlite",
      "sources": [
        "amalgamation/doltlite_orig.c",
        "amalgamation/doltlite.c",
        "amalgamation/blake3_sse2_impl.c",
        "amalgamation/blake3_neon_impl.c",
        "src/addon.cpp",
        "src/bun_compat.cpp",
        "src/database.cpp",
        "src/statement.cpp"
      ],
      "include_dirs": [
        "amalgamation",
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "SQLITE_THREADSAFE=1",
        "SQLITE_ENABLE_FTS5",
        "SQLITE_ENABLE_JSON1",
        "SQLITE_ENABLE_RTREE",
        "SQLITE_ENABLE_COLUMN_METADATA",
        "DOLTLITE_PROLLY=1",
        "BLAKE3_NO_SSE41=1",
        "BLAKE3_NO_AVX2=1",
        "BLAKE3_NO_AVX512=1"
      ],
      "cflags": ["-std=c11", "-fvisibility=hidden"],
      "cflags_cc": ["-std=c++17", "-fvisibility=hidden"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "NO",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++17"]
        }
      },
      "conditions": [
        ["OS=='linux'", {
          "libraries": ["-lpthread", "-ldl", "-lm"],
          "cflags": ["-fPIC"]
        }],
        ["OS=='mac'", {
          "libraries": ["-lpthread"]
        }],
        ["OS=='win'", {
          "defines": ["strncasecmp=_strnicmp"]
        }]
      ]
    }
  ]
}
