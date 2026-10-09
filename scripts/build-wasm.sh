#!/usr/bin/env bash
# Builds the emulator (crates/wasm, over crates/spectrum) to WebAssembly and puts it where the page imports it,
# web/src/emulator/zx.wasm (git-ignored). Cargo is incremental, so when nothing has changed this takes a moment;
# the page's build and its tests run it first, so that the module is never missing or stale.
#
# The build is reproducible: the same sources and Cargo.lock (--locked) with the same toolchain make the same bytes
# wherever they are built, the paths compiled in (panics name their files) written as /zx and /cargo rather than
# where the repository and the registry are. So the module the Dockerfile builds is the very module the tests ran,
# and the smoke test checks that it is (web/tests/smoke.mjs).
#
#   scripts/build-wasm.sh            build (symbols stripped) and copy (wasm-opt only if WASM_OPT=1)
#   ZX_WASM_IN=path scripts/...      take a module already compiled, and copy it
#   ZX_WASM_OUT=path scripts/...     put the module there instead (the Dockerfile's stage of its own, with no web/)
#   WASM_OPT=1                       optimise with wasm-opt -O3 (binaryen): 14% smaller, 1.5% smaller with brotli,
#                                    and no faster in V8; it takes 20 s, and makes the module one no test ran
#
# CARGO_TARGET_DIR is target/wasm unless set, so that this build does not wait on another's lock.
set -euo pipefail
cd "$(dirname "$0")/.."

DST="${ZX_WASM_OUT:-web/src/emulator/zx.wasm}"
SRC="${ZX_WASM_IN:-}"
if [ -z "$SRC" ]; then
  export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target/wasm}"
  ROOT="$(pwd -P)"
  CARGO_HOME_DIR="$(cd "${CARGO_HOME:-$HOME/.cargo}" && pwd -P)"
  export RUSTFLAGS="--remap-path-prefix=$CARGO_HOME_DIR=/cargo --remap-path-prefix=$ROOT=/zx"
  CARGO_PROFILE_RELEASE_STRIP=true cargo build -q --locked --release --target wasm32-unknown-unknown -p zx-wasm
  SRC="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/zx_wasm.wasm"
fi
[ -f "$SRC" ] || { echo "build-wasm: no module at $SRC" >&2; exit 1; }

# Up to date: the module in place was made from this one (optimised or not).
if [ -f "$DST" ] && [ "$DST" -nt "$SRC" ]; then
  exit 0
fi

# wasm-opt (binaryen), only when asked for: on the PATH, or web/'s devDependency.
WANT_OPT="${WASM_OPT:-0}"
WASM_OPT=""
if [ "$WANT_OPT" = "1" ]; then
  if command -v wasm-opt >/dev/null 2>&1; then
    WASM_OPT="wasm-opt"
  elif [ -x web/node_modules/.bin/wasm-opt ]; then
    WASM_OPT="web/node_modules/.bin/wasm-opt"
  fi
fi

# Written beside its place and moved in, so that two builds at once (tests side by side) never leave half a file.
TMP="$(mktemp "$DST.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
if [ -n "$WASM_OPT" ]; then
  "$WASM_OPT" -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
    --enable-mutable-globals --enable-multivalue --enable-reference-types "$SRC" -o "$TMP"
else
  cp "$SRC" "$TMP"
fi
chmod 644 "$TMP"
mv -f "$TMP" "$DST"
trap - EXIT
echo "build-wasm: $DST ($(wc -c < "$DST") bytes${WASM_OPT:+, wasm-opt -O3})" >&2
