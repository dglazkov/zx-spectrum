# The deployed site, as crux's part wasm builds a product with an engine in wasm (crux/wasm/Dockerfile.wasm, copied
# here and filled in). Nothing of the machine runs on the server: the emulator is compiled to WebAssembly in one stage,
# the page is built around it in the next, the ZXDB's own index is fetched in a third, and the server (crates/app, on
# crux's parts) in a fourth; the last stage is the server on distroless, with the built page and the index beside it,
# and no Node. The server hands out the files and passes the archive and the ZXDB through for the page, answering from
# the ZXDB's own index where ZXInfo cannot (crates/app/src/pass.rs). The tests are not run here: they are nerd's
# (nerd.toml), run for what changed before a deploy.

# The machine (crates/wasm over crates/spectrum), with the toolchain its wasm build is tested with: rustc 1.98.1, whose
# optimiser once miscompiled the contention tables (docs/toolchain/); the wasm layer holds that build to the native one.
# crux's tool builds it reproducibly (Cargo.lock as it is, the paths compiled in made the same): this stage makes the
# very bytes the tests ran (scripts/build-wasm.sh), which the smoke test checks against what is served. No wasm-opt
# (--opt): it would make a module no test ran, for 1.5% less to send.
FROM docker.io/library/rust:1.98.1-slim-bookworm AS wasm
RUN rustup target add wasm32-unknown-unknown
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crux crux
# The workspace's other members, and the ROMs the machine compiles in.
COPY roms roms
COPY crates/z80 crates/z80
COPY crates/audio crates/audio
COPY crates/ay crates/ay
COPY crates/tape crates/tape
COPY crates/snapshot crates/snapshot
COPY crates/unzip crates/unzip
COPY crates/spectrum crates/spectrum
COPY crates/wasm crates/wasm
COPY crates/cli crates/cli
# The server's package, which this stage does not build, there so that cargo finds it: its manifest, and a main and a
# lib that do nothing.
COPY crates/app/Cargo.toml crates/app/
RUN mkdir -p crates/app/src && echo 'fn main() {}' > crates/app/src/main.rs && touch crates/app/src/lib.rs
RUN cargo run --locked -q -p wasm -- build zx-wasm --out /wasm/zx.wasm

# The page, built around the module: Node, for the build alone.
FROM docker.io/library/node:24.21.0-slim AS web
WORKDIR /src
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund
COPY roms roms
COPY web web
# Where the page imports the module from. Its build takes it as it is, and builds no wasm of its own.
COPY --from=wasm /wasm/zx.wasm web/src/emulator/zx.wasm
# No source maps: the service answers anyone, and the repository is not public.
RUN cd web && npm run build:page -- --sourcemap false

# The ZXDB's own index, which the server answers the page's searches and entries from where ZXInfo cannot: built from
# the ZXDB's dump the tool pins (ZXDB_COMMIT), checked by its SHA-256. About 2.4 MB; this step runs again only when
# the tool or what it writes the index with changes.
FROM docker.io/library/node:24.21.0-slim AS zxdb
WORKDIR /src/web
COPY web/zxdb.mjs ./
COPY web/tools/zxdb-index.mjs tools/
RUN node tools/zxdb-index.mjs --fetch /tmp/zxdb-index.txt.gz

# The server, on the engine's stage, which has the workspace: its dependencies and crux's parts first, against the
# main that does nothing, so that a change to the server builds only it. Its own profile (Cargo.toml): optimised, not
# as the emulator is.
FROM wasm AS server
RUN cargo build --profile server --locked -p app
COPY crates/app/src crates/app/src
RUN touch crates/app/src/main.rs crates/app/src/lib.rs && cargo build --profile server --locked -p app && cp target/server/app /app

# What runs: the server, the built page it serves and the index it answers from, on the port in PORT.
FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /srv
COPY --from=server /app app
COPY --from=web /src/web/dist dist
COPY --from=zxdb /tmp/zxdb-index.txt.gz zxdb-index.txt.gz
CMD ["/srv/app", "dist"]
