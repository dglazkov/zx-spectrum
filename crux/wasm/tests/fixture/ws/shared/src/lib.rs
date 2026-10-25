//! A crate with no memory of its own, as synth-exp's render-mix: it is handed where a buffer is in the memory it
//! imports, and works in place, with no stack.

#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// `to[i] += from[i]` for `n` floats, each at its byte offset in the shared memory.
///
/// # Safety
///
/// `to` and `from` are each `n` floats of the memory, apart.
#[no_mangle]
pub unsafe extern "C" fn add(to: *mut f32, from: *const f32, n: usize) {
    let (to, from) = (
        core::slice::from_raw_parts_mut(to, n),
        core::slice::from_raw_parts(from, n),
    );
    for (t, f) in to.iter_mut().zip(from) {
        *t += *f;
    }
}
