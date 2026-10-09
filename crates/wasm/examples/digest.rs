//! The machine run natively through the same C interface the browser calls, printing what it showed (a digest of
//! the picture, the memory and the registers at chosen frames) as JSON, so that the WebAssembly build can be held to
//! the native one: web/tests/wasm/wasm.spec.ts runs the same steps through zx.wasm and asks for the same digests.
//! The release build of rustc 1.98.1 once miscompiled the contention tables (docs/toolchain/); this is how a build
//! for the browser would be caught doing the same.
//!
//!   cargo run -p zx-wasm --example digest [SABOTEUR.TZX]

use zx_wasm::*;

/// FNV-1a, 32 bits (the same in the JavaScript).
fn fnv(h: &mut u32, bytes: &[u8]) {
    for &b in bytes {
        *h ^= b as u32;
        *h = h.wrapping_mul(0x0100_0193);
    }
}

/// The picture, all 64K as the CPU sees it, and the registers.
fn digest(z: *mut Zx) -> String {
    let mut h = 0x811C_9DC5u32;
    unsafe {
        fnv(
            &mut h,
            std::slice::from_raw_parts(zx_frame_ptr(z), zx_frame_len() as usize),
        );
        let mem: Vec<u8> = (0..0x10000u32).map(|a| zx_peek(z, a) as u8).collect();
        fnv(&mut h, &mem);
        let regs = std::slice::from_raw_parts(zx_registers(z), 20);
        for r in regs {
            fnv(&mut h, &r.to_le_bytes());
        }
    }
    format!("\"{h:08x}\"")
}

fn main() {
    let mut out = String::from("{\"boot\":{");
    for model in 0..7u32 {
        let z = zx_new(model);
        let mut digests = Vec::new();
        for target in [50u32, 150, 300] {
            while unsafe { zx_frame_count(z) } < target as f64 {
                unsafe { zx_run_frame(z) };
            }
            digests.push(digest(z));
        }
        if model > 0 {
            out.push(',');
        }
        out.push_str(&format!("\"{model}\":[{}]", digests.join(",")));
        unsafe { zx_free(z) };
    }
    out.push_str("},\"saboteur\":");
    match std::env::args().nth(1).map(std::fs::read) {
        Some(Ok(tape)) => {
            // As the page loads it: the 48K switched on, the tape in, LOAD "" typed, the ROM starting the tape.
            let z = zx_new(1);
            unsafe {
                zx_run_frames(z, 100);
                let name = "saboteur.tzx";
                assert_eq!(
                    zx_load(
                        z,
                        tape.as_ptr(),
                        tape.len() as u32,
                        name.as_ptr(),
                        name.len() as u32
                    ),
                    ZX_OK
                );
                let typed = "j\"\"\n";
                zx_type_text(z, typed.as_ptr(), typed.len() as u32);
            }
            let mut digests = Vec::new();
            for target in [1000u32, 2000, 2700] {
                while unsafe { zx_frame_count(z) } < target as f64 {
                    unsafe { zx_run_frame(z) };
                }
                digests.push(digest(z));
            }
            out.push_str(&format!("[{}]", digests.join(",")));
            unsafe { zx_free(z) };
        }
        _ => out.push_str("null"),
    }
    out.push('}');
    println!("{out}");
}
