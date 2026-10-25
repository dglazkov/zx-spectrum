//! The connections the server answers on, as crux's `server::serve` answers, with two things a route needs that it
//! does not give: the address a request came from, and a way to let go of its connection. A client that stops reading
//! what is passed through to it holds the server's write; once the exchange's time is up, the pass-through lets go of
//! the connection ([`Peer::let_go`]), the client with it.

use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use axum::extract::connect_info::Connected;
use axum::serve::IncomingStream;
use futures_util::task::AtomicWaker;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};

/// Whether a connection has been let go of, and the task that serves it, to wake.
#[derive(Default)]
struct Gone {
    gone: AtomicBool,
    waker: AtomicWaker,
}

/// The client a request came from, as a handler finds it in `ConnectInfo<Peer>`.
#[derive(Clone)]
pub struct Peer {
    pub addr: SocketAddr,
    gone: Arc<Gone>,
}

impl Peer {
    /// Closes the connection, whatever it is waiting on: the request on it is not answered further.
    pub fn let_go(&self) {
        self.gone.gone.store(true, Ordering::SeqCst);
        self.gone.waker.wake();
    }
}

/// A connection, as the server reads and writes it: once let go of, every read and write fails.
pub struct Conn {
    io: TcpStream,
    gone: Arc<Gone>,
}

impl Conn {
    fn gone(&self, cx: &mut Context<'_>) -> bool {
        self.gone.waker.register(cx.waker());
        self.gone.gone.load(Ordering::SeqCst)
    }
}

fn aborted() -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionAborted, "let go of")
}

impl AsyncRead for Conn {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        if self.gone(cx) {
            return Poll::Ready(Err(aborted()));
        }
        Pin::new(&mut self.io).poll_read(cx, buf)
    }
}

impl AsyncWrite for Conn {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        if self.gone(cx) {
            return Poll::Ready(Err(aborted()));
        }
        Pin::new(&mut self.io).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.gone(cx) {
            return Poll::Ready(Err(aborted()));
        }
        Pin::new(&mut self.io).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_shutdown(cx)
    }
}

/// A TCP listener whose connections can be let go of.
pub struct Listener(pub TcpListener);

impl axum::serve::Listener for Listener {
    type Io = Conn;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Conn, SocketAddr) {
        loop {
            match self.0.accept().await {
                Ok((io, addr)) => return (Conn { io, gone: Arc::default() }, addr),
                // A connection that went before it was taken is its own; anything else (too many files open) is
                // waited out, as axum's own listener waits.
                Err(e) if matches!(e.kind(), io::ErrorKind::ConnectionAborted | io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionRefused) => {}
                Err(e) => {
                    eprintln!("accept: {e}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }

    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.0.local_addr()
    }
}

impl Connected<IncomingStream<'_, Listener>> for Peer {
    fn connect_info(stream: IncomingStream<'_, Listener>) -> Self {
        Peer { addr: *stream.remote_addr(), gone: stream.io().gone.clone() }
    }
}

/// Answers with `app` on `listener`, each request with its [`Peer`], until the process is told to stop (an
/// interrupt, or Cloud Run's SIGTERM), as crux's `server::serve_on` answers.
pub async fn serve_on(listener: TcpListener, app: axum::Router) -> io::Result<()> {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    axum::serve(Listener(listener), app.into_make_service_with_connect_info::<Peer>())
        .with_graceful_shutdown(async move {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        })
        .await
}

/// Answers with `app` on the port in `PORT` (8080 where unset; 0 for any), on every address, printing "listening on
/// http://ADDR" once it answers, as crux's `server::serve` does.
pub async fn serve(app: axum::Router) -> Result<(), String> {
    let port = server::port(std::env::var("PORT").ok().as_deref())?;
    let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| format!("port {port}: {e}"))?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    println!("listening on http://{addr}");
    serve_on(listener, app).await.map_err(|e| e.to_string())
}
