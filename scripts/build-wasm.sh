#!/usr/bin/env bash
# Builds the emulator (crates/wasm, over crates/spectrum) to WebAssembly and puts it where the page imports it,
# web/src/emulator/zx.wasm (git-ignored), with crux's part wasm (crux/wasm): `cargo run -p wasm -- build zx-wasm`.
# Cargo is incremental, so when nothing has changed this takes a moment; the page's build and its tests run it first,
# so that the module is never missing or stale.
#
# The build is reproducible: the same sources and Cargo.lock (--locked) with the same toolchain make the same bytes
# wherever they are built, the paths compiled in (panics name their files) written as /workspace, /cargo and /target
# rather than where the repository, the registry and the build are. So the module the Dockerfile builds is the very
# module the tests ran, and the smoke test checks that it is (web/tests/smoke.mjs).
#
#   scripts/build-wasm.sh            build (symbols stripped) and write it whole
#   WASM_OPT=1                       optimise with wasm-opt -O3 (binaryen, on the PATH or web/'s devDependency): 14%
#                                    smaller, 1.5% smaller with brotli, and no faster in V8; it takes 20 s, and makes
#                                    the module one no test ran
#
# The tool builds in target/wasm-tool (the module under its wasm/), so that this build does not wait on another's lock.
set -euo pipefail
cd "$(dirname "$0")/.."

OPT=()
if [ "${WASM_OPT:-0}" = "1" ]; then
  OPT=(--opt)
  # crux's tool takes wasm-opt from WASM_OPT, a path, or the PATH.
  unset WASM_OPT
  if ! command -v wasm-opt >/dev/null 2>&1 && [ -x web/node_modules/.bin/wasm-opt ]; then
    export WASM_OPT="$PWD/web/node_modules/.bin/wasm-opt"
  fi
fi
CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target/wasm-tool}" cargo run -q --locked -p wasm -- build zx-wasm --out web/src/emulator/zx.wasm "${OPT[@]}"
