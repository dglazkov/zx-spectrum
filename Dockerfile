# The deployed site. Nothing of the machine runs on the server: the emulator is compiled to WebAssembly in one stage,
# the page is built around it in the next, and the last only hands out the files and passes the archive and the ZXDB
# through for the page (web/server.mjs). The tests are not run here: they are nerd's (nerd.toml), run for what changed
# before a deploy.

# The machine (crates/wasm over crates/spectrum), with the toolchain its wasm build is tested with: rustc 1.98.1, whose
# optimiser once miscompiled the contention tables (docs/toolchain/); the wasm layer holds that build to the native one.
# scripts/build-wasm.sh builds it reproducibly (Cargo.lock as it is, the paths compiled in made the same): this stage
# makes the very bytes the tests ran, which the smoke test checks against what is served. No wasm-opt: it would make a
# module no test ran, for 1.5% less to send.
FROM rust:1.98.1-slim AS wasm
RUN rustup target add wasm32-unknown-unknown
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY roms roms
COPY crates crates
COPY scripts/build-wasm.sh scripts/
RUN ZX_WASM_OUT=/tmp/zx_wasm.wasm bash scripts/build-wasm.sh

# The page, with the module put where it is imported from.
FROM node:24.21.0-slim AS web
WORKDIR /app
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY scripts scripts
COPY roms roms
COPY web web
COPY --from=wasm /tmp/zx_wasm.wasm /tmp/zx_wasm.wasm
# No source maps: the service answers anyone, and the repository is not public.
RUN cd web && ZX_WASM_IN=/tmp/zx_wasm.wasm npm run build -- --sourcemap false

FROM node:24.21.0-slim
WORKDIR /app
ENV NODE_ENV=production
COPY web/server.mjs ./
COPY --from=web /app/web/dist dist
USER node
# The platform says which port, in PORT.
CMD ["node", "server.mjs"]
