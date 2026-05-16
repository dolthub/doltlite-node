# config.make.in gets filtered by the top-most configure script to
# create config.make.
bin.bash = /usr/bin/bash
bin.emcc = /home/runner/work/doltlite/doltlite/tool/emcc.sh
bin.wasm-strip = /opt/hostedtoolcache/wabt-1.0.36/bin/wasm-strip
bin.wasm-opt = /opt/hostedtoolcache/emsdk/upstream/bin/wasm-opt

SHELL = $(bin.bash)

# The following overrides can be uncommented to test various
# validation and if/else branches the makefile code:
#
#bin.bash =
#bin.emcc =
#bin.wasm-strip =
#bin.wasm-opt =
