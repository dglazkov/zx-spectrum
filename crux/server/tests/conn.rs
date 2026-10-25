//! A client that stops reading what it is sent, as serve_on lets go of its connection (crux#45): one that stops
//! partway through a large answer, its connection closed once the write has made no headway for the stall, other
//! requests answered meanwhile; one that reads slowly, pausing for less than the stall, sent all of it; and a route
//! that lets go of its own connection with its Peer.

use std::future::Future;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::pin::Pin;
use std::sync::{mpsc, Arc};
use std::task::{Context, Poll};
use std::time::Duration;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::routing::get;
use futures_core::Stream;
use server::{header, Bytes, Peer};

/// A chunk of an answer, and how many of them make the large one: 256 MB, far more than the kernel holds for a
/// client that stops reading.
const CHUNK: usize = 64 * 1024;
const CHUNKS: usize = 4096;

/// Says once that the answer it is part of was dropped, as the server drops it with its connection.
struct Dropped(mpsc::Sender<()>);

impl Drop for Dropped {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

/// The large answer's chunks of zeros, as a stream, saying that the answer was dropped as it is.
struct Zeros {
    left: usize,
    _dropped: Dropped,
}

impl Stream for Zeros {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if self.left == 0 {
            return Poll::Ready(None);
        }
        self.left -= 1;
        Poll::Ready(Some(Ok(Bytes::from(vec![0u8; CHUNK]))))
    }
}

/// A chunk, and then, once the client says it has read it, the connection let go of, as the rest of the answer
/// waits forever.
struct LetGo {
    peer: Peer,
    sent: bool,
    read: Option<Pin<Box<dyn Future<Output = ()> + Send>>>,
}

impl Stream for LetGo {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if !self.sent {
            self.sent = true;
            return Poll::Ready(Some(Ok(Bytes::from(vec![1u8; CHUNK]))));
        }
        if let Some(read) = &mut self.read {
            if read.as_mut().poll(cx).is_ready() {
                self.read = None;
                self.peer.let_go();
            }
        }
        Poll::Pending
    }
}

/// A server of the test's own, letting go of a connection whose write stalls for `stall`: `/big` answers 256 MB,
/// `/small` a word, and `/let-go` a chunk, then lets go of its connection once `/read` is asked; and each time an
/// answer of `/big` is dropped, a word on the channel.
fn server(stall: Duration) -> (String, mpsc::Receiver<()>) {
    let (dropped, on_drop) = mpsc::channel();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(listener.local_addr().unwrap().to_string()).unwrap();
            let big = move || {
                let dropped = Dropped(dropped.clone());
                async move {
                    let body = Body::from_stream(Zeros {
                        left: CHUNKS,
                        _dropped: dropped,
                    });
                    ([(header::CONTENT_LENGTH, CHUNK * CHUNKS)], body)
                }
            };
            let told = Arc::new(tokio::sync::Notify::new());
            let (said, tell) = (told.clone(), told);
            let let_go = move |ConnectInfo(peer): ConnectInfo<Peer>| {
                let said = said.clone();
                let read = Box::pin(async move { said.notified().await });
                async move {
                    let body = Body::from_stream(LetGo {
                        peer,
                        sent: false,
                        read: Some(read),
                    });
                    ([(header::CONTENT_LENGTH, 2 * CHUNK)], body)
                }
            };
            let read = move || {
                tell.notify_one();
                async { "" }
            };
            let app = axum::Router::new()
                .route("/big", get(big))
                .route("/small", get(|| async { "small\n" }))
                .route("/let-go", get(let_go))
                .route("/read", get(read));
            server::serve_on_within(listener, app, stall).await.unwrap();
        });
    });
    (rx.recv().unwrap(), on_drop)
}

/// A connection asking for `path`, its head read: the reader, and the answer's status.
fn ask(addr: &str, path: &str) -> (BufReader<TcpStream>, u16) {
    let mut s = TcpStream::connect(addr).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
    let req = format!("GET {path} HTTP/1.1\r\nHost: crux.test\r\nConnection: close\r\n\r\n");
    s.write_all(req.as_bytes()).unwrap();
    let mut reader = BufReader::new(s);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let status = line.split(' ').nth(1).unwrap().parse().unwrap();
    loop {
        let mut l = String::new();
        reader.read_line(&mut l).unwrap();
        if l.trim_end().is_empty() {
            break;
        }
    }
    (reader, status)
}

/// What is left of the answer, to its end: as the connection closes, or where it is cut off; never a connection
/// that is still open, which waits out the reader's time.
fn rest(reader: &mut BufReader<TcpStream>) -> Vec<u8> {
    let mut body = Vec::new();
    if let Err(e) = reader.read_to_end(&mut body) {
        let open = matches!(
            e.kind(),
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
        );
        assert!(!open, "the connection was never closed: {e}");
    }
    body
}

#[test]
fn a_client_that_stops_reading_is_let_go_of() {
    let (addr, dropped) = server(Duration::from_millis(500));
    let (mut held, status) = ask(&addr, "/big");
    assert_eq!(status, 200);
    let mut some = vec![0u8; CHUNK];
    held.read_exact(&mut some).unwrap();
    // It reads no more; the server is asked meanwhile, and answers.
    let (mut other, status) = ask(&addr, "/small");
    assert_eq!(status, 200);
    assert!(String::from_utf8(rest(&mut other))
        .unwrap()
        .contains("small"));
    // Its connection is closed by the stall, the answer dropped with it.
    dropped
        .recv_timeout(Duration::from_secs(60))
        .expect("the stalled connection was never let go of");
    // What the kernel held for it is read, and then the connection's end, short of the whole answer.
    let got = some.len() + rest(&mut held).len();
    assert!(
        got < CHUNK * CHUNKS,
        "got {got} bytes, the whole answer, of a connection let go of"
    );
}

#[test]
fn a_client_that_reads_slowly_is_sent_all_of_it() {
    // Each pause is shorter than the stall; all of them together are longer, so the stall is counted from the
    // write's last headway, not from its first wait.
    let (addr, _dropped) = server(Duration::from_secs(3));
    let (mut slow, status) = ask(&addr, "/big");
    assert_eq!(status, 200);
    let mut got = 0;
    let mut part = vec![0u8; CHUNK];
    for _ in 0..4 {
        std::thread::sleep(Duration::from_secs(1));
        for _ in 0..16 {
            slow.read_exact(&mut part).unwrap();
            got += part.len();
        }
    }
    got += rest(&mut slow).len();
    assert_eq!(got, CHUNK * CHUNKS);
}

#[test]
fn a_route_lets_go_of_its_connection() {
    let (addr, _dropped) = server(server::STALL);
    let (mut gone, status) = ask(&addr, "/let-go");
    assert_eq!(status, 200);
    // The chunk it sent, and once the client says it has it, the connection's end, short of the answer.
    let mut first = vec![0u8; CHUNK];
    gone.read_exact(&mut first).unwrap();
    let (_, status) = ask(&addr, "/read");
    assert_eq!(status, 200);
    let more = rest(&mut gone);
    assert!(
        more.is_empty(),
        "{} bytes more of a connection let go of",
        more.len()
    );
    // The server answers on.
    let (mut other, status) = ask(&addr, "/small");
    assert_eq!(status, 200);
    assert!(String::from_utf8(rest(&mut other))
        .unwrap()
        .contains("small"));
}
