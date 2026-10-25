//! The connections [`serve_on`](super::serve_on) answers on (crux#45), lifted out of zx-spectrum's own: a client
//! that stops reading what it is sent holds the server's write, and each of its connections held so is let go of.
//!
//! A write on a connection that makes no headway for [`STALL`] fails, and the connection is closed, the request on
//! it answered no further: no product need watch for a client that stopped reading. And a route may let go of its
//! own connection, at once, whatever it is waiting on ([`Peer::let_go`]), as a pass-through does once its exchange's
//! time is up: each request carries its [`Peer`], as `ConnectInfo<Peer>`, beside its address.

use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use axum::extract::connect_info::Connected;
use axum::serve::IncomingStream;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::Sleep;

/// How long a write to a client may make no headway before its connection is let go of: half a minute, long past
/// what a phone on a poor network keeps a server waiting.
pub const STALL: Duration = Duration::from_secs(30);

/// Whether a connection has been let go of, and the task that serves it, to wake.
#[derive(Default)]
struct Gone {
    gone: AtomicBool,
    waker: Mutex<Option<Waker>>,
}

/// The client a request came from, as a route finds it in `ConnectInfo<Peer>`.
#[derive(Clone)]
pub struct Peer {
    pub addr: SocketAddr,
    gone: Arc<Gone>,
}

impl Peer {
    /// Closes the connection, whatever it is waiting on: the request on it is answered no further.
    pub fn let_go(&self) {
        self.gone.gone.store(true, Ordering::SeqCst);
        if let Some(waker) = self.gone.waker.lock().unwrap().take() {
            waker.wake();
        }
    }
}

/// A connection, as the server reads and writes it: once let go of, or once a write has made no headway for its
/// stall, every read and write fails.
pub struct Conn {
    io: TcpStream,
    gone: Arc<Gone>,
    stall: Duration,
    /// When the write waiting now is given up on; none while no write waits.
    stalled: Option<Pin<Box<Sleep>>>,
}

impl Conn {
    fn gone(&self, cx: &mut Context<'_>) -> bool {
        let mut waker = self.gone.waker.lock().unwrap();
        if !waker.as_ref().is_some_and(|w| w.will_wake(cx.waker())) {
            *waker = Some(cx.waker().clone());
        }
        self.gone.gone.load(Ordering::SeqCst)
    }

    /// What a write came to: where it waits, whether it has waited its stall; where it is done, the stall begun again.
    fn waited<T>(
        &mut self,
        cx: &mut Context<'_>,
        polled: Poll<io::Result<T>>,
    ) -> Poll<io::Result<T>> {
        if polled.is_ready() {
            self.stalled = None;
            return polled;
        }
        let stall = self.stall;
        let stalled = self
            .stalled
            .get_or_insert_with(|| Box::pin(tokio::time::sleep(stall)));
        match stalled.as_mut().poll(cx) {
            Poll::Ready(()) => Poll::Ready(Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("the client read nothing for {} s", stall.as_secs_f64()),
            ))),
            Poll::Pending => Poll::Pending,
        }
    }
}

fn aborted() -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionAborted, "let go of")
}

impl AsyncRead for Conn {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.gone(cx) {
            return Poll::Ready(Err(aborted()));
        }
        Pin::new(&mut self.io).poll_read(cx, buf)
    }
}

impl AsyncWrite for Conn {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.gone(cx) {
            return Poll::Ready(Err(aborted()));
        }
        let polled = Pin::new(&mut self.io).poll_write(cx, buf);
        self.waited(cx, polled)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        if self.gone(cx) {
            return Poll::Ready(Err(aborted()));
        }
        let polled = Pin::new(&mut self.io).poll_write_vectored(cx, bufs);
        self.waited(cx, polled)
    }

    fn is_write_vectored(&self) -> bool {
        self.io.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        if self.gone(cx) {
            return Poll::Ready(Err(aborted()));
        }
        let polled = Pin::new(&mut self.io).poll_flush(cx);
        self.waited(cx, polled)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.io).poll_shutdown(cx)
    }
}

/// A TCP listener whose connections are let go of: by a route, or once a write to one stalls for `stall`.
pub struct Listener {
    pub tcp: TcpListener,
    pub stall: Duration,
}

impl axum::serve::Listener for Listener {
    type Io = Conn;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Conn, SocketAddr) {
        loop {
            match self.tcp.accept().await {
                Ok((io, addr)) => {
                    let conn = Conn {
                        io,
                        gone: Arc::default(),
                        stall: self.stall,
                        stalled: None,
                    };
                    return (conn, addr);
                }
                // A connection that went before it was taken is its own; anything else (too many files open) is
                // waited out, as axum's own listener waits.
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::ConnectionAborted
                            | io::ErrorKind::ConnectionReset
                            | io::ErrorKind::ConnectionRefused
                    ) => {}
                Err(e) => {
                    eprintln!("accept: {e}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    }

    fn local_addr(&self) -> io::Result<SocketAddr> {
        self.tcp.local_addr()
    }
}

impl Connected<IncomingStream<'_, Listener>> for Peer {
    fn connect_info(stream: IncomingStream<'_, Listener>) -> Self {
        Peer {
            addr: *stream.remote_addr(),
            gone: stream.io().gone.clone(),
        }
    }
}
