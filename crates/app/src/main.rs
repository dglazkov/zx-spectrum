//! zx-spectrum's server (lib.rs says what it serves).
//!
//!   app [DIR]                  serves DIR (web/dist where none is given) on the port in PORT (8080 if unset)
//!   app zxdb INDEX PATH        what the ZXDB's index at INDEX answers for an API path, as /search?query=saboteur
//!
//! ZXINFO_ORIGIN puts a stand-in in the ZXInfo API's place, for a test (web/tests/page/harness.mjs); ZXDB_INDEX says
//! where the ZXDB's index is, where it is not beside the server, as the image puts it.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

use app::pass::{self, Pass};
use app::zxdb::Zxdb;

/// The index beside the server, as the image puts it, or where ZXDB_INDEX says.
fn index() -> PathBuf {
    if let Some(path) = std::env::var_os("ZXDB_INDEX") {
        return path.into();
    }
    let exe = std::env::current_exe().ok();
    exe.as_deref().and_then(Path::parent).unwrap_or(Path::new(".")).join("zxdb-index.txt.gz")
}

fn zxdb(index: &str, path: &str) -> ExitCode {
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    let zxdb = Zxdb::at(index);
    if zxdb.index().is_none() {
        eprintln!("zxdb: no index at {index}");
        return ExitCode::FAILURE;
    }
    match zxdb.answer(path, query) {
        Some((status, json)) => {
            eprintln!("{status}");
            println!("{}", String::from_utf8_lossy(&json));
            ExitCode::SUCCESS
        }
        None => {
            eprintln!("zxdb: the index does not answer {path}");
            ExitCode::FAILURE
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("zxdb") {
        return match &args[1..] {
            [index, path] => zxdb(index, path),
            _ => {
                eprintln!("usage: app zxdb INDEX PATH");
                ExitCode::from(2)
            }
        };
    }
    let dist = args.first().cloned().unwrap_or_else(|| "web/dist".into());
    let zxinfo = std::env::var("ZXINFO_ORIGIN").ok().filter(|o| !o.is_empty());
    let routes = pass::routes(zxinfo.as_deref(), Arc::new(Zxdb::at(index())));
    let app = match app::app(Path::new(&dist), Arc::new(Pass::deployed(routes))) {
        Ok(app) => app,
        Err(err) => {
            eprintln!("{dist}: {err}");
            return ExitCode::FAILURE;
        }
    };
    if let Err(err) = server::serve(app).await {
        eprintln!("{err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
