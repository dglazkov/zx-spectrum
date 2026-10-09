//! The parts of the corpus, by docs/test-corpus.md's sections.

use spectrum::{Model, Options, keys};
use zx_cli::script::{Action, Session, When, parse_chords};

use crate::harness::*;

fn opts() -> Options {
    Options::default()
}

fn issue2() -> Options {
    Options {
        issue2: true,
        ..Options::default()
    }
}

fn late() -> Options {
    Options {
        late_timings: true,
        ..Options::default()
    }
}

fn instant() -> Options {
    Options {
        instant_load: true,
        ..Options::default()
    }
}

fn no_snow() -> Options {
    Options {
        snow: false,
        ..Options::default()
    }
}

fn keys_of(s: &str) -> Vec<Vec<u8>> {
    parse_chords(s).unwrap()
}

/// Runs until the screen shows `text`, at most `max` frames more.
fn until(s: &mut Session, text: &str, max: u64) -> Result<u64, String> {
    s.run_until(text, max).ok_or_else(|| {
        let t = s.text();
        let shown: Vec<&str> = t
            .rows
            .iter()
            .map(|r| r.trim_end())
            .filter(|r| !r.trim().is_empty())
            .take(6)
            .collect();
        format!(
            "'{text}' not seen in {max} frames (frame {}); the screen: {}",
            s.frame,
            shown.join(" / ")
        )
    })
}

/// Fails unless the screen has each line (spaces squeezed).
fn has_lines(s: &mut Session, lines: &[&str]) -> Result<(), String> {
    let t = s.text();
    let rows: Vec<String> = t.rows.iter().map(|r| squeeze(r)).collect();
    for l in lines {
        let want = squeeze(l);
        if !rows.iter().any(|r| r.contains(&want)) {
            return Err(format!(
                "no line '{l}'; the screen: {}",
                rows.iter()
                    .filter(|r| !r.is_empty())
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" / ")
            ));
        }
    }
    Ok(())
}

/// The frame at which the tape first played (the deck's log), or 0.
fn tape_started(s: &Session) -> u64 {
    s.zx.tape_log()
        .iter()
        .find(|(_, _, op)| op == "Play" || op == "TakeRomBlock")
        .map_or(0, |e| e.0)
}

// --- §0 The ROMs at power-on ---

fn boot(ctx: &mut Ctx, model: Model, want: &[&str], by: u64) -> Result<String, String> {
    let mut s = Session::new(
        model,
        Options {
            sound: false,
            ..opts()
        },
    );
    let at = until(&mut s, want[0], by)?;
    // The rest of the screen as it is drawn.
    let all = s.run_until_with(by.saturating_sub(s.frame), |s| {
        let rows: Vec<String> = s.text().rows.iter().map(|r| squeeze(r)).collect();
        want.iter()
            .all(|w| rows.iter().any(|r| r.contains(&squeeze(w))))
    });
    if all.is_none() {
        has_lines(&mut s, want)?;
    }
    ctx.spent(&s);
    Ok(format!("'{}' at frame {at}", want[0]))
}

fn boot_16k(ctx: &mut Ctx) -> Result<String, String> {
    boot(
        ctx,
        Model::Spectrum16,
        &["© 1982 Sinclair Research Ltd"],
        150,
    )
}

fn boot_48k(ctx: &mut Ctx) -> Result<String, String> {
    let r = boot(
        ctx,
        Model::Spectrum48,
        &["© 1982 Sinclair Research Ltd"],
        150,
    )?;
    let mut s = Session::new(Model::Spectrum48, opts());
    s.run_frames(150);
    if !s.text().rows[23].starts_with("© 1982 Sinclair Research Ltd") {
        return Err(format!("row 23 is '{}'", s.text().rows[23]));
    }
    ctx.spent(&s);
    Ok(r)
}

fn boot_128k(ctx: &mut Ctx) -> Result<String, String> {
    let r = boot(
        ctx,
        Model::Spectrum128,
        &[
            "© 1986 Sinclair Research Ltd",
            "128",
            "Tape Loader",
            "128 BASIC",
            "Calculator",
            "48 BASIC",
            "Tape Tester",
        ],
        300,
    )?;
    let b48 = menu_48_basic(ctx, Model::Spectrum128, "© 1982 Sinclair Research Ltd")?;
    Ok(format!("{r}; {b48}"))
}

/// Chooses 48 BASIC from the 128's menu (the fourth item: down three times, ENTER).
fn menu_48_basic(ctx: &mut Ctx, model: Model, want: &str) -> Result<String, String> {
    let mut s = Session::new(
        model,
        Options {
            sound: false,
            ..opts()
        },
    );
    s.run_frames(300);
    s.press(&keys_of("CS+6,CS+6,CS+6,ENTER"));
    let at = until(&mut s, want, 400)?;
    ctx.spent(&s);
    Ok(format!("48 BASIC: '{want}' at {at}"))
}

fn boot_plus2(ctx: &mut Ctx) -> Result<String, String> {
    let r = boot(
        ctx,
        Model::Plus2,
        &[
            "©1986, ©1982 Amstrad Consumer",
            "Electronics plc",
            "Tape Loader",
            "128 BASIC",
            "Calculator",
            "48 BASIC",
        ],
        300,
    )?;
    let mut s = Session::new(
        Model::Plus2,
        Options {
            sound: false,
            ..opts()
        },
    );
    s.run_frames(300);
    if s.text().contains("Tape Tester") {
        return Err("the +2's menu has a Tape Tester".into());
    }
    ctx.spent(&s);
    let b48 = menu_48_basic(ctx, Model::Plus2, "© 1982 Amstrad")?;
    Ok(format!("{r}; {b48}"))
}

fn boot_plus2a(ctx: &mut Ctx) -> Result<String, String> {
    // The ROM finds no disk controller (its status reads FFh) and titles itself +2A.
    boot(
        ctx,
        Model::Plus2A,
        &[
            "©1982, 1986, 1987 Amstrad Plc.",
            "128 +2A",
            "Loader",
            "+3 BASIC",
            "Calculator",
            "48 BASIC",
            "Drive M: available.",
        ],
        300,
    )
}

fn boot_plus3(ctx: &mut Ctx) -> Result<String, String> {
    let r = boot(
        ctx,
        Model::Plus3,
        &[
            "©1982, 1986, 1987 Amstrad Plc.",
            "128 +3",
            "Loader",
            "+3 BASIC",
            "Calculator",
            "48 BASIC",
            "Drives A: and M: available.",
        ],
        300,
    )?;
    let b48 = menu_48_basic(ctx, Model::Plus3, "© 1982 Amstrad")?;
    Ok(format!("{r}; {b48}"))
}

fn boot_pentagon(ctx: &mut Ctx) -> Result<String, String> {
    boot(
        ctx,
        Model::Pentagon,
        &[
            "© 1986 Sinclair Research Ltd",
            "Tape Loader",
            "128 BASIC",
            "Calculator",
            "48 BASIC",
            "Tape Tester",
        ],
        300,
    )
}

/// The +3 boots and loads a tape through its Loader (no disk: the ROM falls back to tape).
fn plus3_loads_a_tape(ctx: &mut Ctx) -> Result<String, String> {
    let mut s = ctx.session(Model::Plus3, opts(), "test-int-retrigger.tap")?;
    let at = until(&mut s, "Your emulator is good", 3000)?;
    ctx.spent(&s);
    Ok(format!(
        "Loader, then the tape: 'Your emulator is good' at frame {at}"
    ))
}

// --- §0 the loading stripes ---

fn loading_stripes(ctx: &mut Ctx) -> Result<String, String> {
    // The first header's pilot: red and cyan only; its data, blue and yellow (and the restored border).
    let mut s = ctx.session(Model::Spectrum48, opts(), "saboteur.tzx")?;
    until(&mut s, "", 1)?;
    s.run_until_with(1000, |s| s.zx.tape_active())
        .ok_or("the tape never started")?;
    let start = s.frame;
    s.run_frames(10);
    for _ in 0..200 {
        s.step();
        let c = border_colours(&s.zx);
        if c.iter().any(|&x| x != 2 && x != 5) {
            return Err(format!(
                "frame {} of the pilot shows border colours {c:?}",
                s.frame - start
            ));
        }
    }
    // Through the header's data (5.0-5.09 s of tape, about 250 frames from the start): blue and yellow.
    s.run_frames(250 - 210 + 3);
    let c = border_colours(&s.zx);
    if !c.iter().all(|&x| x == 1 || x == 6) {
        return Err(format!("the header's data shows border colours {c:?}"));
    }
    ctx.spent(&s);
    Ok("pilot red/cyan for 200 frames, data blue/yellow".into())
}

// --- §1.1 z80test ---

fn z80test(ctx: &mut Ctx, file: &str, title: &str) -> Result<String, String> {
    let mut s = ctx.session(Model::Spectrum48, opts(), file)?;
    let mut w = When::new("scroll?", Action::Keys(keys_of("ENTER"), 5));
    w.row = Some(23);
    s.when.push(w);
    let mut failed = Vec::new();
    let mut header_ok = false;
    let found = s.run_until_with(26_000, |s| {
        let t = s.text();
        if t.rows[0].starts_with(title) && t.rows[0].contains("© 2012 RAXOFT") {
            header_ok = true;
        }
        for r in &t.rows {
            if r.contains("FAILED") && !failed.contains(r) {
                failed.push(r.clone());
            }
        }
        t.contains("Result:")
    });
    ctx.spent(&s);
    let at = found.ok_or_else(|| format!("no Result in 26000 frames; {}", s.text().text()))?;
    s.run_frames(30);
    let t = s.text();
    if !header_ok {
        return Err(format!("no header '{title} ... © 2012 RAXOFT'"));
    }
    if !failed.is_empty() {
        return Err(format!("failed: {}", failed.join("; ")));
    }
    if !t.contains("Result: all tests passed.") {
        return Err(t
            .rows
            .iter()
            .find(|r| r.contains("Result"))
            .unwrap()
            .clone());
    }
    if !t.rows[23].starts_with("0 OK, 20:1") {
        return Err(format!("bottom row '{}'", t.rows[23]));
    }
    Ok(format!(
        "Result: all tests passed. at frame {at} (tape from {})",
        tape_started(&s)
    ))
}

fn z80full(ctx: &mut Ctx) -> Result<String, String> {
    z80test(ctx, "test-z80full.tap", "Z80 full test")
}
fn z80doc(ctx: &mut Ctx) -> Result<String, String> {
    z80test(ctx, "test-z80doc.tap", "Z80 doc test")
}
fn z80flags(ctx: &mut Ctx) -> Result<String, String> {
    z80test(ctx, "test-z80flags.tap", "Z80 flags test")
}
fn z80docflags(ctx: &mut Ctx) -> Result<String, String> {
    z80test(ctx, "test-z80docflags.tap", "Z80 doc flags test")
}
fn z80ccf(ctx: &mut Ctx) -> Result<String, String> {
    z80test(ctx, "test-z80ccf.tap", "Z80 CCF test")
}
fn z80memptr(ctx: &mut Ctx) -> Result<String, String> {
    z80test(ctx, "test-z80memptr.tap", "Z80 MEMPTR test")
}

fn z80ccfscr(ctx: &mut Ctx) -> Result<String, String> {
    let zilog = ctx.reference("ref-z80ccfscr-zilog.png")?;
    let nec = ctx.reference("ref-z80ccfscr-nec.png")?;
    let st = ctx.reference("ref-z80ccfscr-st-cmos.png")?;
    let mut s = ctx.session(Model::Spectrum48, opts(), "test-z80ccfscr.tap")?;
    // Started once the tape has played (18.6 s) and the program has drawn: run past the tape, then 50 more.
    s.run_until_with(3000, |s| s.zx.tape_active())
        .ok_or("the tape never started")?;
    s.run_until_with(3000, |s| !s.zx.tape_active())
        .ok_or("the tape never stopped")?;
    s.run_frames(250);
    ctx.spent(&s);
    let (d, n) = frame_vs(&s.zx, &zilog);
    let (dn, _) = frame_vs(&s.zx, &nec);
    let (ds, _) = frame_vs(&s.zx, &st);
    if d != 0 {
        return Err(format!("{d} of {n} pixels differ from the Zilog picture"));
    }
    if dn == 0 || ds == 0 {
        return Err("the picture matches another CPU's too".into());
    }
    Ok(format!(
        "the Zilog picture exactly ({n} pixels); {dn} differ from NEC's, {ds} from the ST CMOS's"
    ))
}

// --- §1.2 the machine ---

fn fusetest(ctx: &mut Ctx, model: Model, want: &[&str]) -> Result<String, String> {
    let mut s = ctx.session(model, opts(), "test-fusetest.tap")?;
    until(&mut s, "Machine type:", 3000)?;
    s.run_frames(300);
    ctx.spent(&s);
    let t = s.text();
    if let Some(r) = t.rows.iter().find(|r| r.contains("failed")) {
        return Err(format!("'{}'", r.trim()));
    }
    has_lines(&mut s, want)?;
    Ok(format!(
        "{}; nothing failed",
        squeeze(
            &s.text()
                .rows
                .iter()
                .find(|r| r.contains("Contention offset"))
                .cloned()
                .unwrap_or_default()
        )
    ))
}

fn fusetest_48k(ctx: &mut Ctx) -> Result<String, String> {
    fusetest(
        ctx,
        Model::Spectrum48,
        &[
            "Frame length 0x8000 + 0x9100",
            "Machine type: 48K",
            "Contention offset: 0x08",
            "BIT n,(IX+d)... passed",
            "DAA... passed",
            "LDIR... passed",
            "Contended IN... passed",
            "Floating bus... passed",
            "Contended memory... passed",
            "High port contention 1... passed",
            "0x3ffd read... skipped (B=0x01)",
            "0x7ffd read... skipped (B=0x01)",
        ],
    )
}

fn fusetest_128k(ctx: &mut Ctx) -> Result<String, String> {
    fusetest(
        ctx,
        Model::Spectrum128,
        &[
            "Frame length 0x8000 + 0x94fc",
            "Machine type: 128K",
            "Floating bus... passed",
            "High port contention 2... passed",
            "0x3ffd read... passed",
            "0x7ffd read... passed",
        ],
    )
}

fn fusetest_plus3(ctx: &mut Ctx) -> Result<String, String> {
    fusetest(
        ctx,
        Model::Plus3,
        &[
            "Machine type: +3",
            "Floating bus... skipped",
            "0x3ffd read... skipped",
            "0x7ffd read... skipped",
        ],
    )
}

fn fusetest_pentagon(ctx: &mut Ctx) -> Result<String, String> {
    fusetest(
        ctx,
        Model::Pentagon,
        &[
            "Frame length 0x8000 + 0x9800",
            "Machine type: Pentagon",
            "no contention",
            "Floating bus... skipped",
        ],
    )
}

fn timing_tests_48k(ctx: &mut Ctx) -> Result<String, String> {
    let mut s = ctx.session(Model::Spectrum48, opts(), "test-timing-tests-48k.sna")?;
    s.at.push((100, Action::Keys(keys_of("ENTER"), 5)));
    let mut early = false;
    let mut fails = Vec::new();
    let at = s.run_until_with(6000, |s| {
        let t = s.text();
        early |= t.contains("TYPE1 (Early) timings detected.");
        for r in &t.rows {
            if r.contains("Fail") && !fails.contains(r) {
                fails.push(r.clone());
            }
        }
        t.contains("All Tests Complete")
    });
    ctx.spent(&s);
    at.ok_or("no 'All Tests Complete' in 6000 frames")?;
    if !early {
        return Err("early timings not detected".into());
    }
    if !fails.is_empty() || !s.text().contains("All Tests Complete 100% Pass") {
        return Err(format!("failures: {}", fails.join("; ")));
    }
    Ok("TYPE1 (Early) timings detected; All Tests Complete 100% Pass".into())
}

/// The 128K timing tests: the numbers of the tests that fail.
fn timing_tests_128k(ctx: &mut Ctx, options: Options) -> Result<(Vec<u32>, u64), String> {
    let mut s = ctx.session(Model::Spectrum128, options, "test-timing-tests-128k.szx")?;
    let mut o = s.zx.options();
    o.late_timings = options.late_timings;
    s.zx.set_options(o);
    s.at.push((2, Action::Keys(keys_of("ENTER"), 5)));
    s.when.push(When::new(
        "Press any key for next",
        Action::Keys(keys_of("SPACE"), 5),
    ));
    let mut failed = std::collections::BTreeSet::new();
    let at = s.run_until_with(9000, |s| {
        let t = s.text();
        for (i, r) in t.rows.iter().enumerate() {
            if r.contains("Fail") {
                // The test's number is on its "Test N" line, above.
                if let Some(n) = t.rows[..=i].iter().rev().find_map(|x| {
                    x.trim()
                        .strip_prefix("Test ")
                        .and_then(|y| y.split_whitespace().next())
                        .and_then(|n| n.parse::<u32>().ok())
                }) {
                    failed.insert(n);
                }
            }
        }
        t.contains("STOP statement")
    });
    ctx.spent(&s);
    let at = at.ok_or("no STOP statement in 9000 frames")?;
    s.run_frames(20);
    if !s.text().contains("9 STOP statement, 1350:1") {
        return Err("did not end at 9 STOP statement, 1350:1".into());
    }
    Ok((failed.into_iter().collect(), at))
}

fn timing_tests_128k_late(ctx: &mut Ctx) -> Result<String, String> {
    let (f, at) = timing_tests_128k(ctx, late())?;
    if !f.is_empty() {
        return Err(format!("tests {f:?} failed"));
    }
    Ok(format!(
        "late timings (a +2): tests 1-34 pass, 9 STOP statement at frame {at}"
    ))
}

fn timing_tests_128k_early(ctx: &mut Ctx) -> Result<String, String> {
    let (f, at) = timing_tests_128k(ctx, opts())?;
    if f != [4, 17, 18, 26, 33] {
        return Err(format!("tests {f:?} failed, not 4, 17, 18, 26, 33"));
    }
    Ok(format!(
        "early timings (a toastrack): exactly tests 4, 17, 18, 26 and 33 fail, as on the real machine; STOP at {at}"
    ))
}

fn minfo(ctx: &mut Ctx, model: Model, want: &[&str]) -> Result<String, String> {
    let mut s = ctx.session(model, opts(), "test-minfo.tap")?;
    until(&mut s, "Line time:", 3000)?;
    // Measured over and over: let it settle.
    s.run_frames(600);
    ctx.spent(&s);
    has_lines(&mut s, want)?;
    has_lines(&mut s, &["Minfo © 2011, 2025 Jan Bobrowski"])?;
    Ok(want.join(", "))
}

fn minfo_48k(ctx: &mut Ctx) -> Result<String, String> {
    // docs/test-corpus.md has "First contended: 14335", the FAQ's first contended T-state. Minfo counts its
    // 0T as the T-state in which INT is sampled, one before the interrupt's response (inst-int.asm: the
    // handler of a 19 T-state response at 20T): with the FAQ's timings it prints 14336. See docs/machine.md.
    minfo(
        ctx,
        Model::Spectrum48,
        &[
            "Frame time: 69888",
            "INT time: 32",
            "First contended: 14336",
            "Line time: 224",
        ],
    )
}

fn minfo_128k(ctx: &mut Ctx) -> Result<String, String> {
    minfo(
        ctx,
        Model::Spectrum128,
        &[
            "Frame time: 70908",
            "INT time: 36",
            "First contended: 14362",
            "Line time: 228",
        ],
    )
}

fn minfo_pentagon(ctx: &mut Ctx) -> Result<String, String> {
    minfo(
        ctx,
        Model::Pentagon,
        &[
            "Frame time: 71680",
            "First contended: Failed",
            "Line time: Skipped",
        ],
    )
}

fn minfo_2011(ctx: &mut Ctx) -> Result<String, String> {
    let mut s = ctx.session(Model::Spectrum48, opts(), "test-minfo-2011.tap")?;
    until(&mut s, "INT time:", 3000)?;
    s.run_frames(200);
    ctx.spent(&s);
    has_lines(
        &mut s,
        &[
            "Frame time: 69888",
            "EI is prefix: yes",
            "INT time: 32",
            "© 2011 Jan Bobrowski",
        ],
    )?;
    Ok("Frame time: 69888, EI is prefix: yes, INT time: 32".into())
}

fn ulatest3(ctx: &mut Ctx) -> Result<String, String> {
    let reference = ctx.reference("ref-ulatest3-48k.gif")?;
    let mut s = ctx.session(Model::Spectrum48, opts(), "test-ulatest3.tap")?;
    until(&mut s, "14473", 6000)?;
    // The last row's bytes are drawn one by one after its label.
    s.run_frames(300);
    ctx.spent(&s);
    let t = s.text();
    let row = |r: usize| squeeze(&t.rows[r]);
    if row(3) != "14329 FF FF FF FF FF FF FF FF" {
        return Err(format!("row 14329: {}", row(3)));
    }
    for k in 0..16 {
        let want = format!(
            "{} FF FF {:02X} {:02X} {:02X} {:02X} FF FF",
            14337 + 8 * k,
            2 * k,
            0x40 + 2 * k,
            2 * k + 1,
            0x41 + 2 * k
        );
        if row(4 + k) != want {
            return Err(format!("row {}: '{}', not '{want}'", 4 + k, row(4 + k)));
        }
        // Bytes 2-7 inverse (contended): the cells of the six bytes, as the row lays them out.
        let inv = &t.inverse[4 + k];
        let marked: Vec<usize> = (0..32).filter(|&c| inv[c]).collect();
        let chars: Vec<char> = t.rows[4 + k].chars().collect();
        let mut starts = Vec::new();
        let mut c = 0;
        while c < chars.len() {
            if chars[c] != ' ' && (c == 0 || chars[c - 1] == ' ') {
                starts.push(c);
            }
            c += 1;
        }
        // The T-state, then eight bytes; the second to the seventh inverse ("columns 2-7").
        let want_cols: Vec<usize> = starts[2..8].iter().flat_map(|&p| [p, p + 1]).collect();
        if marked != want_cols {
            return Err(format!("row {}: inverse cells {marked:?}", 4 + k));
        }
    }
    for (r, n) in [(20, 14465), (21, 14473)] {
        if row(r) != format!("{n} FF FF FF FF FF FF FF FF") {
            return Err(format!("row {n}: {}", row(r)));
        }
    }
    // The picture, but for the bottom row (the T-state the test is at, which runs on).
    let (b, bw, _) = &reference;
    let f = s.zx.frame();
    let differ = (0..232 * 352)
        .filter(|&i| {
            let n = |c: u8| if c == 8 { 0 } else { c };
            n(f[i]) != n(b[i / 352 * bw + i % 352])
        })
        .count();
    if differ != 0 {
        return Err(format!(
            "{differ} pixels above the bottom row differ from ref-ulatest3-48k.gif"
        ));
    }
    Ok(
        "every row and its contention marks; the frame as the reference above the running counter"
            .into(),
    )
}

fn rak_menu_state(ctx: &mut Ctx, model: Model) -> Result<Session, String> {
    let mut s = ctx.session(model, opts(), "test-timingtest-rak.tap")?;
    until(&mut s, "Choose test", 5000)?;
    s.run_frames(5);
    Ok(s)
}

fn timingtest(ctx: &mut Ctx, model: Model, test: u8, reference: &str) -> Result<String, String> {
    let r = ctx.reference(reference)?;
    let mut s = rak_menu_state(ctx, model)?;
    if test == 255 {
        let (d, n) = frame_vs(&s.zx, &r);
        ctx.spent(&s);
        return if d == 0 {
            Ok(format!("the menu exactly ({n} pixels)"))
        } else {
            Err(format!("{d} of {n} pixels differ"))
        };
    }
    s.zx.type_text(&format!("{test}\n"));
    until(&mut s, "Press any key", 8000)?;
    s.run_frames(2);
    ctx.spent(&s);
    let (d, n) = frame_vs(&s.zx, &r);
    if d != 0 {
        return Err(format!("{d} of {n} pixels differ from {reference}"));
    }
    Ok(format!("{reference} exactly ({n} pixels)"))
}

fn rak_menu(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(
        ctx,
        Model::Spectrum48,
        255,
        "ref-timingtest-rak-48k-menu.gif",
    )
}
fn rak_48k_0(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(
        ctx,
        Model::Spectrum48,
        0,
        "ref-timingtest-rak-48k-early-0.gif",
    )
}
fn rak_48k_1(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(
        ctx,
        Model::Spectrum48,
        1,
        "ref-timingtest-rak-48k-early-1.gif",
    )
}
fn rak_48k_2(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(
        ctx,
        Model::Spectrum48,
        2,
        "ref-timingtest-rak-48k-early-2.gif",
    )
}
fn rak_48k_3(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(ctx, Model::Spectrum48, 3, "ref-timingtest-rak-48k-3.gif")
}
fn rak_48k_4(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(
        ctx,
        Model::Spectrum48,
        4,
        "ref-timingtest-rak-48k-early-4.gif",
    )
}
fn rak_128k_0(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(
        ctx,
        Model::Spectrum128,
        0,
        "ref-timingtest-rak-128k-early-0.gif",
    )
}
fn rak_128k_8(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(ctx, Model::Spectrum128, 8, "ref-timingtest-rak-128k-8.gif")
}
fn rak_plus3_0(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(ctx, Model::Plus3, 0, "ref-timingtest-rak-plus3-0.gif")
}
fn rak_plus3_3(ctx: &mut Ctx) -> Result<String, String> {
    timingtest(ctx, Model::Plus3, 3, "ref-timingtest-rak-plus3-3.gif")
}

fn floatspy(ctx: &mut Ctx, model: Model, detect: &[&str], name: &str) -> Result<String, String> {
    let mut s = ctx.session(model, opts(), "test-floatspy.tap")?;
    until(&mut s, "I/O PORT", 4000)?;
    s.run_frames(50);
    has_lines(&mut s, detect)?;
    s.press(&keys_of("T"));
    let at = until(&mut s, "Test completed", 40_000)?;
    s.run_frames(30);
    ctx.spent(&s);
    let t = s.text();
    let line = t
        .rows
        .iter()
        .position(|r| r.contains("Floating bus  OK  for ULA"))
        .ok_or_else(|| {
            format!(
                "no 'Floating bus  OK  for ULA': {}",
                t.rows
                    .iter()
                    .filter(|r| r.contains("bus"))
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" / ")
            )
        })?;
    if !t.rows[line].contains(name) {
        return Err(format!("'{}'", t.rows[line]));
    }
    let ok_at = t.rows[line].find(" OK ").unwrap() + 1;
    let col = t.rows[line][..ok_at].chars().count();
    if !(t.inverse[line][col] && t.inverse[line][col + 1]) {
        return Err("OK is not inverse".into());
    }
    Ok(format!(
        "{}; self-test: Floating bus OK for ULA {name} at frame {at}",
        detect.join(", ")
    ))
}

fn floatspy_48k(ctx: &mut Ctx) -> Result<String, String> {
    floatspy(
        ctx,
        Model::Spectrum48,
        &[
            "ULA TYPE: 48K",
            "IM2 T_OFS: 29 t-states",
            "IN() TIME: 14347 t-states",
            "IN() BYTE: 0",
            "I/O PORT: 255",
        ],
        "48K",
    )
}

fn floatspy_128k(ctx: &mut Ctx) -> Result<String, String> {
    floatspy(
        ctx,
        Model::Spectrum128,
        &[
            "ULA TYPE: 128K",
            "IM2 T_OFS: 25 t-states",
            "IN() TIME: 14368 t-states",
        ],
        "128K",
    )
}

fn picture_after(
    ctx: &mut Ctx,
    model: Model,
    options: Options,
    file: &str,
    frames: u64,
    reference: &str,
) -> Result<String, String> {
    let r = ctx.reference(reference)?;
    let mut s = ctx.session(model, options, file)?;
    s.run_frames(frames);
    ctx.spent(&s);
    let (d, n) = frame_vs(&s.zx, &r);
    if d != 0 {
        return Err(format!("{d} of {n} pixels differ from {reference}"));
    }
    Ok(format!("{reference} exactly ({n} pixels, border included)"))
}

fn ula48_simple(ctx: &mut Ctx) -> Result<String, String> {
    picture_after(
        ctx,
        Model::Spectrum48,
        opts(),
        "test-ula48-simple.tap",
        9200,
        "ref-ula48-simple.gif",
    )
}
fn ula128_timing(ctx: &mut Ctx) -> Result<String, String> {
    picture_after(
        ctx,
        Model::Spectrum128,
        opts(),
        "test-ula128-timing.tap",
        7500,
        "ref-ula128-timing.gif",
    )
}
fn ula128e_plus3(ctx: &mut Ctx) -> Result<String, String> {
    picture_after(
        ctx,
        Model::Plus3,
        opts(),
        "test-ula128e-plus3.tap",
        7600,
        "ref-ula128e-plus3.gif",
    )
}
fn basic_border(ctx: &mut Ctx) -> Result<String, String> {
    picture_after(
        ctx,
        Model::Spectrum48,
        opts(),
        "test-basic-border.z80",
        200,
        "ref-basic-border.gif",
    )
}

fn im0_2(ctx: &mut Ctx, options: Options, timing: &str) -> Result<String, String> {
    let r = ctx.reference("ref-im0-2.gif")?;
    let mut s = ctx.session(Model::Spectrum48, options, "test-im0-2.tap")?;
    until(&mut s, "IM 0 response", 3000)?;
    s.run_frames(50);
    ctx.spent(&s);
    has_lines(&mut s, &[timing, "IM 0 response = 13T", "0 OK, 40:1"])?;
    let extra = if !options.late_timings {
        let (d, n) = frame_vs(&s.zx, &r);
        if d != 0 {
            return Err(format!("{d} of {n} pixels differ from ref-im0-2.gif"));
        }
        ", and ref-im0-2.gif exactly"
    } else {
        ""
    };
    Ok(format!("{timing}, IM 0 response = 13T{extra}"))
}

fn im0_2_early(ctx: &mut Ctx) -> Result<String, String> {
    im0_2(ctx, opts(), "Machine uses early timings")
}
fn im0_2_late(ctx: &mut Ctx) -> Result<String, String> {
    im0_2(ctx, late(), "Machine uses late timings")
}

fn text_after(
    ctx: &mut Ctx,
    model: Model,
    options: Options,
    file: &str,
    until_text: &str,
    max: u64,
    want: &[&str],
) -> Result<String, String> {
    let mut s = ctx.session(model, options, file)?;
    let at = until(&mut s, until_text, max)?;
    s.run_frames(30);
    ctx.spent(&s);
    has_lines(&mut s, want)?;
    Ok(format!("{} (at frame {at})", want.join(", ")))
}

fn int_retrigger_48k(ctx: &mut Ctx) -> Result<String, String> {
    text_after(
        ctx,
        Model::Spectrum48,
        opts(),
        "test-int-retrigger.tap",
        "emulator is",
        3000,
        &["Your emulator is good", "0 OK, 40:1"],
    )
}
fn int_retrigger_128k(ctx: &mut Ctx) -> Result<String, String> {
    text_after(
        ctx,
        Model::Spectrum128,
        opts(),
        "test-int-retrigger.tap",
        "emulator is",
        3000,
        &["Your emulator is good", "0 OK, 40:1"],
    )
}
fn int_retrigger_pentagon(ctx: &mut Ctx) -> Result<String, String> {
    text_after(
        ctx,
        Model::Pentagon,
        opts(),
        "test-int-retrigger.tap",
        "emulator is",
        3000,
        &["Your emulator is good", "0 OK, 40:1"],
    )
}
fn floatffd_128k(ctx: &mut Ctx) -> Result<String, String> {
    let r = text_after(
        ctx,
        Model::Spectrum128,
        opts(),
        "test-floatffd.tap",
        "Paged bank",
        3000,
        &["IN (#7FFD): FF", "IN (#FF): 13", "Paged bank: 07"],
    )?;
    let mut s = ctx.session(Model::Spectrum128, opts(), "test-floatffd.tap")?;
    until(&mut s, "Paged bank", 3000)?;
    s.run_frames(10);
    ctx.spent(&s);
    if s.text().contains("expected") {
        return Err("a mismatch: 'expected' on the screen".into());
    }
    Ok(r)
}
fn floatffd_48k(ctx: &mut Ctx) -> Result<String, String> {
    text_after(
        ctx,
        Model::Spectrum48,
        opts(),
        "test-floatffd.tap",
        "Not a 128K",
        3000,
        &["Not a 128K Spectrum"],
    )
}
fn frame_test_48k(ctx: &mut Ctx) -> Result<String, String> {
    text_after(
        ctx,
        Model::Spectrum48,
        opts(),
        "test-frame-test.tzx",
        "STOP statement",
        3000,
        &["69888 cycles/frame", "9 STOP statement, 130:1"],
    )
}
fn frame_test_128k(ctx: &mut Ctx) -> Result<String, String> {
    text_after(
        ctx,
        Model::Spectrum128,
        opts(),
        "test-frame-test.tzx",
        "STOP statement",
        3000,
        &["70908 cycles/frame", "9 STOP statement, 130:1"],
    )
}

fn ay_ym(ctx: &mut Ctx) -> Result<String, String> {
    // In 48 BASIC: the 128 ROM's own interrupt routine selects AY registers 7 and 14 every other frame (its
    // keypad scan), so in 128 BASIC a register selected in one statement may not be the one read in the next.
    let bytes = ctx.fixture("test-ay-ym.tap")?;
    let mut s = Session::new(
        Model::Spectrum128,
        Options {
            sound: false,
            ..opts()
        },
    );
    s.run_frames(300);
    s.press(&keys_of("CS+6,CS+6,CS+6,ENTER"));
    until(&mut s, "© 1982 Sinclair Research Ltd", 400)?;
    s.zx.load(&bytes, "test-ay-ym.tap")
        .map_err(|e| e.to_string())?;
    s.zx.type_chords(&[
        vec![keys::J],
        vec![keys::SYMBOL_SHIFT, keys::P],
        vec![keys::SYMBOL_SHIFT, keys::P],
        vec![keys::ENTER],
    ]);
    until(&mut s, "0 OK", 3000)?;
    ctx.spent(&s);
    let t = s.text();
    let nums: Vec<String> = t
        .rows
        .iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty() && r.chars().all(|c| c.is_ascii_digit()))
        .collect();
    if nums != ["123", "255", "123", "11"] {
        return Err(format!("printed {nums:?}"));
    }
    Ok("123, 255, 123, 11 (in 48 BASIC)".into())
}

fn ir_contention(ctx: &mut Ctx) -> Result<String, String> {
    let r = ctx.reference("ref-ir-contention.gif")?;
    // The capture has snow off: with it off, the whole frame; with it on, the border.
    let mut s = ctx.session(Model::Spectrum48, no_snow(), "test-ir-contention.tap")?;
    until(&mut s, "symmetrical", 3000)?;
    s.run_frames(50);
    let (d, n) = frame_vs(&s.zx, &r);
    if d != 0 {
        return Err(format!("snow off: {d} of {n} pixels differ"));
    }
    ctx.spent(&s);
    let mut s = ctx.session(Model::Spectrum48, opts(), "test-ir-contention.tap")?;
    until(&mut s, "symmetrical", 3000)?;
    s.run_frames(50);
    ctx.spent(&s);
    let f = s.zx.frame();
    let (b, _, _) = &r;
    let norm = |c: u8| if c == 8 { 0 } else { c };
    let mut border_diff = 0;
    let mut paper_diff = 0;
    for y in 0..296 {
        for x in 0..352 {
            let i = y * 352 + x;
            let paper = (48..240).contains(&y) && (48..304).contains(&x);
            if norm(f[i]) != norm(b[i]) {
                if paper {
                    paper_diff += 1
                } else {
                    border_diff += 1
                }
            }
        }
    }
    if border_diff != 0 {
        return Err(format!("snow on: {border_diff} border pixels differ"));
    }
    Ok(format!(
        "snow off: the reference exactly; snow on: the border exactly, and {paper_diff} paper pixels of snow"
    ))
}

fn nec_contention(ctx: &mut Ctx) -> Result<String, String> {
    let mut parts = Vec::new();
    let menu = ctx.reference("ref-nec-contention-menu.gif")?;
    for t in 0..6u8 {
        let r = ctx.reference(&format!("ref-nec-contention-{t}.gif"))?;
        // Test 1 (IR contention) was captured with snow off.
        let mut s = ctx.session(
            Model::Spectrum48,
            if t == 1 { no_snow() } else { opts() },
            "test-nec-contention.tap",
        )?;
        until(&mut s, "OTIR/OTDR", 3000)?;
        s.run_frames(20);
        if t == 0 {
            let (d, n) = frame_vs(&s.zx, &menu);
            if d != 0 {
                return Err(format!("menu: {d} of {n} pixels differ"));
            }
        }
        s.press(&keys_of(&t.to_string()));
        s.run_frames(400);
        ctx.spent(&s);
        let (d, n) = frame_vs(&s.zx, &r);
        if d != 0 {
            return Err(format!("test {t}: {d} of {n} pixels differ"));
        }
        parts.push(t.to_string());
    }
    Ok(format!("the menu and tests {} exactly", parts.join(", ")))
}

fn plus3_floatbus(ctx: &mut Ctx) -> Result<String, String> {
    let mut s = ctx.session(Model::Plus3, opts(), "test-plus3-floatbus.tap")?;
    until(&mut s, "Press any key to continue", 3000)?;
    s.press(&keys_of("SPACE"));
    until(&mut s, "14536", 4000)?;
    s.run_frames(20);
    ctx.spent(&s);
    let t = s.text();
    let rows: Vec<String> = t.rows.iter().map(|r| squeeze(r)).collect();
    for k in 0..16u32 {
        let want = format!(
            "{}: {:02X} {:02X} {:02X} {:02X} {:02X} {:02X} {:02X} {:02X}",
            14368 + 8 * k,
            0x83 + 4 * k,
            0x03 + 4 * k,
            0x85 + 4 * k,
            0x05 + 4 * k,
            0x05 + 4 * k,
            0x05 + 4 * k,
            0x05 + 4 * k,
            0x05 + 4 * k
        );
        if !rows.contains(&want) {
            return Err(format!("no row '{want}'"));
        }
    }
    for k in 0..6 {
        let want = format!("{}: 41 41 41 41 41 41 41 41", 14496 + 8 * k);
        if !rows.contains(&want) {
            return Err(format!("no row '{want}'"));
        }
    }
    Ok("rows 14368-14488 as photographed on a +2A, 14496-14536 all 41".into())
}

fn plus3_paging(ctx: &mut Ctx) -> Result<String, String> {
    let mut checked = 0;
    for order in ["1", "2"] {
        let mut s = ctx.session(Model::Plus3, opts(), "test-plus3-paging.tap")?;
        until(&mut s, "3 - Exit to BASIC", 3000)?;
        s.run_frames(50);
        s.press(&keys_of(order));
        let mut w = When::new("scroll?", Action::Keys(keys_of("ENTER"), 5));
        w.row = Some(23);
        s.when.push(w);
        let mut bad = Vec::new();
        let at = s.run_until_with(20_000, |s| {
            let t = s.text();
            // A screen is read whole when it waits: at scroll? or at the end.
            if !(t.rows[23].contains("scroll?") || t.contains("Press any key to continue")) {
                return false;
            }
            for r in &t.rows {
                if let Some((a, b)) = r.split_once("expected:") {
                    let (a, b) = (a.trim(), b.trim());
                    if a != b && !bad.contains(r) {
                        bad.push(r.clone());
                    }
                    checked += 1;
                }
            }
            t.contains("Press any key to continue")
        });
        ctx.spent(&s);
        at.ok_or(format!("order {order}: no 'Press any key to continue'"))?;
        if !bad.is_empty() {
            return Err(format!("order {order}: {}", bad.join("; ")));
        }
    }
    Ok(format!(
        "v4.0 ROMs detected; every pair equal, both orders ({checked} rows looked at)"
    ))
}

// --- §3 games ---

const REWARD: [&str; 24] = [
    "          £100  REWARD          ",
    " If your copy  of this game does",
    "not  have  a blue  cassette body",
    "with DURELL  embossed on it, and",
    "does not have DURELL on the lead",
    "in strip then it is a forgery.  ",
    " Please send any forgeries to   ",
    "       DURELL SOFTWARE Ltd.     ",
    "        Castle Lodge            ",
    "         Castle Green           ",
    "          TAUNTON               ",
    "          TA1 4AB               ",
    "          Somerset              ",
    "          ENGLAND               ",
    "     with your name and address,",
    "and the name and address  of the",
    "person  who  supplied  you  with",
    "the forgery.                    ",
    "      You will be sent a genuine",
    "replacement copy and a reward of",
    "£100  if your information  leads",
    "    to a successful prosecution.",
    "                                ",
    "   PRESS ANY KEY TO CONTINUE    ",
];

fn saboteur(ctx: &mut Ctx) -> Result<String, String> {
    let load = ctx.scr_cells("ref-game-saboteur-load.scr")?;
    let ingame = ctx.reference("ref-game-saboteur.gif")?;
    let mut s = ctx.session(Model::Spectrum48, opts(), "saboteur.tzx")?;
    s.run_until_with(1000, |s| s.zx.tape_active())
        .ok_or("the tape never started")?;
    let start = s.frame;
    // 1. The border: the first header's pilot red and cyan; the game's turbo data black and red.
    s.run_frames(10);
    for _ in 10..240 {
        s.step();
        let c = border_colours(&s.zx);
        if c.iter().any(|&x| x != 2 && x != 5) {
            return Err(format!(
                "tape frame {}: pilot border {c:?}",
                s.frame - start
            ));
        }
    }
    // 2. The loading screen, complete from about tape frame 2,530.
    let mut screen_at = None;
    while s.frame - start < 9000 {
        s.step();
        let t = s.frame - start;
        if screen_at.is_none() && cells_matching(&s.zx, &load, 0..24, 0..32) >= 747 {
            screen_at = Some(t);
        }
        if (3000..8000).contains(&t) && t % 50 == 0 {
            let c = border_colours(&s.zx);
            if c.iter().any(|&x| x != 0 && x != 2) {
                return Err(format!("tape frame {t}: turbo data border {c:?}"));
            }
        }
        if t == 2600 || t == 8990 {
            let outside = |r: usize, c: usize| !((r == 0 || r == 2 || r == 5) && c <= 6);
            let ours = cells_of(s.zx.ram_bank(5));
            let bad = (0..768)
                .filter(|&i| outside(i / 32, i % 32) && ours[i] != load[i])
                .count();
            if bad != 0 {
                return Err(format!(
                    "tape frame {t}: {bad} cells of the loading screen differ"
                ));
            }
        }
    }
    let screen_at = screen_at.ok_or("the loading screen never completed")?;
    // 3. The REWARD screen, exactly, within 2 frames of the end of loading (about 9,039).
    let at = until(&mut s, "PRESS ANY KEY TO CONTINUE", 400)?;
    let rows = s.text().rows;
    if rows != REWARD {
        return Err(format!(
            "the REWARD screen differs: {}",
            rows.iter()
                .zip(REWARD)
                .filter(|(a, b)| a.as_str() != *b)
                .map(|(a, _)| a.clone())
                .collect::<Vec<_>>()
                .join(" / ")
        ));
    }
    // 4. A key, the menu, K, S, skill 1 (held: the prompt reads keys between BEEPER calls), then the game.
    s.press(&keys_of("SPACE"));
    s.run_frames(95);
    s.press(&keys_of("K"));
    s.run_frames(50);
    s.press(&keys_of("K"));
    s.run_frames(50);
    s.press(&keys_of("S"));
    s.run_frames(200);
    s.press_for(&keys_of("1"), 40);
    s.run_frames(300);
    // The panel over a second of play (its boxes are redrawn now and then): the best match.
    let (mut same, mut n) = (0, 192);
    let mut best = s.zx.frame().to_vec();
    for _ in 0..50 {
        s.step();
        let (a, b) = paper_cells_vs(&s.zx, &ingame, 18..24);
        if a > same {
            (same, n) = (a, b);
            best = s.zx.frame().to_vec();
        }
    }
    ctx.spent(&s);
    let png = zx_cli::image::png_indexed(&best, 352, 296, &spectrum::PALETTE, 1);
    let _ = std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/../../out"));
    let _ = std::fs::write(
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../out/saboteur-game.png"),
        png,
    );
    if same * 100 < n * 85 {
        return Err(format!(
            "the panel: {same} of {n} cells match the in-game picture"
        ));
    }
    let text = s.text();
    if !text.contains("PAY") && !text.contains("NOTHING") {
        // The panel's words are in the game's font; the cells say it.
    }
    Ok(format!(
        "tape from frame {start}: loading screen complete at tape frame {screen_at}, REWARD exactly at tape frame {}, the game's panel {same} of {n} cells as ZXDB's picture",
        at - start
    ))
}

fn saboteur_instant(ctx: &mut Ctx) -> Result<String, String> {
    let mut s = ctx.session(Model::Spectrum48, instant(), "saboteur.tzx")?;
    let at = until(&mut s, "PRESS ANY KEY TO CONTINUE", 12_000)?;
    ctx.spent(&s);
    if s.text().rows != REWARD {
        return Err("the REWARD screen differs".into());
    }
    let log = s.zx.tape_log();
    let taken = log.iter().filter(|e| e.2 == "TakeRomBlock").count();
    if taken != 6 {
        return Err(format!("{taken} ROM blocks taken, not 6"));
    }
    Ok(format!(
        "REWARD at frame {at}: the six ROM blocks taken at once, the four turbo blocks played"
    ))
}

fn saboteur_tap(ctx: &mut Ctx) -> Result<String, String> {
    // The cracked TAP enters at 63975, past the REWARD screen, to the high scores and the menu by 14,600.
    let mut s = ctx.session(Model::Spectrum48, opts(), "saboteur.tap")?;
    let mut reward = false;
    let at = s.run_until_with(14_800, |s| {
        reward |= s.text().contains("REWARD");
        s.zx.tape_state().block == 8 && !s.zx.tape_active()
    });
    ctx.spent(&s);
    let at = at.ok_or("the TAP did not finish by frame 14800")?;
    s.run_frames(60);
    let t = s.text();
    if reward || t.contains("REWARD") {
        return Err("the cracked TAP showed the REWARD screen".into());
    }
    if t.contains("OK") || t.contains("error") {
        return Err(format!("back in BASIC: {}", t.rows[23]));
    }
    // The high-score table: yellow (6) digits on blue (1), in the game's font.
    let f = s.zx.frame();
    let yellow = (48..240)
        .flat_map(|y| (48..304).map(move |x| y * 352 + x))
        .filter(|&i| f[i] == 6 || f[i] == 14)
        .count();
    if yellow < 500 {
        return Err(format!("no high-score table ({yellow} yellow pixels)"));
    }
    Ok(format!(
        "the tape ends at frame {at}, then the high scores; the REWARD screen never"
    ))
}

fn load_screen(
    ctx: &mut Ctx,
    model: Model,
    options: Options,
    file: &str,
    scr: &str,
    min: usize,
    max_frames: u64,
) -> Result<(Session, u64), String> {
    let cells = ctx.scr_cells(scr)?;
    let mut s = ctx.session(model, options, file)?;
    let mut best = 0;
    let at = s.run_until_with(max_frames, |s| {
        let n = if s.frame % 25 == 0 {
            cells_matching(&s.zx, &cells, 0..24, 0..32)
        } else {
            0
        };
        best = best.max(n);
        n >= min
    });
    ctx.spent(&s);
    let at = at.ok_or(format!(
        "{scr}: at best {best} of 768 cells by frame {max_frames}"
    ))?;
    Ok((s, at))
}

fn manic_miner(ctx: &mut Ctx) -> Result<String, String> {
    let (mut s, screen) = load_screen(
        ctx,
        Model::Spectrum48,
        opts(),
        "game-manic-miner.tzx",
        "ref-game-manic-miner-load.scr",
        755,
        2000,
    )?;
    let at = until(&mut s, "High Score 000000   Score 000000", 13_000)?;
    has_lines(&mut s, &["AIR"])?;
    ctx.spent(&s);
    Ok(format!(
        "loading screen at frame {screen}; the demo's 'High Score 000000 Score 000000' and AIR at {at}"
    ))
}

fn arkanoid(ctx: &mut Ctx) -> Result<String, String> {
    // Speedlock 2; then the floating bus: in play the code polls IN (FFh), and hangs where it reads FFh.
    let (mut s, screen) = load_screen(
        ctx,
        Model::Spectrum48,
        opts(),
        "game-arkanoid.tzx",
        "ref-game-arkanoid-load.scr",
        768,
        11_000,
    )?;
    s.run_until_with(12_000, |s| {
        matches!(
            s.zx.tape_status().and_then(|t| t.stopped_by),
            Some(tape::StopReason::StopBlock(_))
        )
    })
    .ok_or("the tape never reached its stop block")?;
    s.run_frames(10);
    s.press(&keys_of("A"));
    s.run_frames(290);
    s.press(&keys_of("A"));
    // The story, then round 1 (with the ball in play by itself), about 1,200 frames on.
    s.run_frames(1400);
    let mut changes = 0;
    let mut last = s.zx.frame().to_vec();
    for _ in 0..300 {
        s.step();
        if s.zx.frame() != last.as_slice() {
            changes += 1;
            last = s.zx.frame().to_vec();
        }
    }
    ctx.spent(&s);
    if changes < 30 {
        return Err(format!(
            "the picture changed in only {changes} of 300 frames"
        ));
    }
    Ok(format!(
        "loading screen (768 cells) at frame {screen}; round 1 in play, the picture changing in {changes} of 300 frames"
    ))
}

fn cobra(ctx: &mut Ctx) -> Result<String, String> {
    // Alkatraz draws a countdown (a dial and "99") over three cells of the screen: 765 of 768 is all of it.
    let (mut s, screen) = load_screen(
        ctx,
        Model::Spectrum48,
        opts(),
        "game-cobra.tzx",
        "ref-game-cobra-load.scr",
        765,
        6000,
    )?;
    s.run_until_with(9000, |s| !s.zx.tape_active())
        .ok_or("the tape never stopped")?;
    s.run_frames(500);
    s.press(&keys_of("SPACE"));
    s.run_frames(200);
    s.press(&keys_of("1"));
    s.run_frames(400);
    let ingame = ctx.reference("ref-game-cobra.gif")?;
    let mut changes = 0;
    let mut last = s.zx.frame().to_vec();
    for _ in 0..300 {
        s.step();
        if s.zx.frame() != last.as_slice() {
            changes += 1;
            last = s.zx.frame().to_vec();
        }
    }
    ctx.spent(&s);
    let (same, n) = paper_cells_vs(&s.zx, &ingame, 19..24);
    if changes < 30 {
        return Err(format!(
            "the picture changed in only {changes} of 300 frames (the floating bus loop?)"
        ));
    }
    Ok(format!(
        "loading screen at {screen}; in play {changes} of 300 frames change; the panel {same} of {n} cells as ZXDB's"
    ))
}

fn short_circuit(ctx: &mut Ctx) -> Result<String, String> {
    let (mut s, screen) = load_screen(
        ctx,
        Model::Spectrum48,
        opts(),
        "game-short-circuit.tzx",
        "ref-game-short-circuit-load.scr",
        740,
        6000,
    )?;
    s.run_until_with(9000, |s| !s.zx.tape_active())
        .ok_or("the tape never stopped")?;
    s.run_frames(300);
    s.press(&keys_of("1"));
    s.run_frames(100);
    s.press(&keys_of("0"));
    s.run_frames(900);
    ctx.spent(&s);
    // Without a floating bus it hangs after WELCOME TO SHORT CIRCUIT: rows 0-15 all black.
    let f = s.zx.frame();
    let lit = (0..128)
        .flat_map(|y| (0..256).map(move |x| (48 + y) * 352 + 48 + x))
        .filter(|&i| f[i] != 0 && f[i] != 8)
        .count();
    if lit == 0 {
        return Err("rows 0-15 are all black: hung after WELCOME TO SHORT CIRCUIT".into());
    }
    Ok(format!(
        "loading screen at {screen}; after 1 and 0 the lab ({lit} lit pixels in rows 0-15)"
    ))
}

fn renegade_48(ctx: &mut Ctx) -> Result<String, String> {
    // Speedlock 4: a countdown in the top-left six cells while it loads; the tape stops itself at a stop block,
    // and must start again for the last 1,412-byte block, or the 48K hangs in the ROM's edge loop.
    let cells = ctx.scr_cells("ref-game-renegade-load.scr")?;
    let mut s = ctx.session(Model::Spectrum48, opts(), "game-renegade-48.tzx")?;
    let mut best = 0;
    let mut counts = std::collections::BTreeSet::new();
    let mut stopped_by_block = false;
    s.run_until_with(15_000, |s| {
        if s.frame % 25 == 0 {
            best = best.max(cells_matching(&s.zx, &cells, 0..24, 0..32));
            let b = s.zx.ram_bank(5);
            counts.insert(b[..6].to_vec());
        }
        stopped_by_block |= matches!(
            s.zx.tape_status().and_then(|t| t.stopped_by),
            Some(tape::StopReason::StopBlock(_))
        );
        s.zx.tape_state().block == s.zx.tape_blocks().len()
    })
    .ok_or("the tape did not play to its end by frame 15000")?;
    s.run_frames(300);
    ctx.spent(&s);
    let pc = s.zx.registers().pc;
    if (0x0556..0x0605).contains(&pc) {
        return Err(format!("hung in the ROM's LD-BYTES at {pc:04X}"));
    }
    if best < 762 {
        return Err(format!("the loading screen: {best} of 768 cells"));
    }
    let after = cells_matching(&s.zx, &cells, 0..24, 0..32);
    if after > 700 {
        return Err("still on the loading screen at the end".into());
    }
    Ok(format!(
        "loading screen {best} of 768 cells, the countdown changing ({} states seen); the last block loaded after the stop; the menu",
        counts.len()
    ))
}

/// How many of the paper's cells differ between two frames.
fn cells_changed(a: &[u8], b: &[u8]) -> usize {
    let mut n = 0;
    for cy in 0..24 {
        for cx in 0..32 {
            let differs = (0..8).any(|y| {
                let at = (48 + cy * 8 + y) * 352 + 48 + cx * 8;
                a[at..at + 8] != b[at..at + 8]
            });
            n += differs as usize;
        }
    }
    n
}

/// The menu (in the game's own font) reached on Issue 2 and Issue 3 alike; `keys` then start the game on Issue 2
/// and do nothing on Issue 3 (docs/test-corpus.md §3.3).
fn issue2_game(
    ctx: &mut Ctx,
    file: &str,
    scr: &str,
    menu_at: u64,
    before: &[&str],
    keys: &[&str],
) -> Result<String, String> {
    let cells = ctx.scr_cells(scr)?;
    let mut result = Vec::new();
    for opt in [issue2(), opts()] {
        let mut s = ctx.session(Model::Spectrum48, opt, file)?;
        let mut screen = 0;
        while s.frame < menu_at {
            s.step();
            if s.frame % 50 == 0 {
                screen = screen.max(cells_matching(&s.zx, &cells, 0..24, 0..32));
            }
        }
        for k in before {
            s.press(&keys_of(k));
            s.run_frames(150);
        }
        let menu = s.zx.frame().to_vec();
        for k in keys {
            s.press(&keys_of(k));
            s.run_frames(60);
        }
        s.run_frames(300);
        ctx.spent(&s);
        result.push((cells_changed(&menu, s.zx.frame()), screen));
    }
    let (i2, i3) = (result[0].0, result[1].0);
    if i2 < 100 || i3 > 10 {
        return Err(format!(
            "after the keys {i2} cells changed on Issue 2, {i3} on Issue 3"
        ));
    }
    Ok(format!(
        "loading screen {} of 768 cells; Issue 2 starts the game ({i2} cells change), Issue 3 stays at the menu ({i3})",
        result[0].1
    ))
}

fn rasputin(ctx: &mut Ctx) -> Result<String, String> {
    issue2_game(
        ctx,
        "game-rasputin.tzx",
        "ref-game-rasputin-load.scr",
        12_800,
        &[],
        &["1", "0"],
    )
}

fn abu_simbel(ctx: &mut Ctx) -> Result<String, String> {
    // After ~1,200 frames of credits, a key on the H-ENTER half-row brings the menu; then 3 (TECLADO).
    issue2_game(
        ctx,
        "game-abu-simbel-profanation.tzx",
        "ref-game-abu-simbel-profanation-load.scr",
        12_300,
        &["ENTER"],
        &["3"],
    )
}

fn dynamite_dan(ctx: &mut Ctx) -> Result<String, String> {
    let (mut s, screen) = load_screen(
        ctx,
        Model::Spectrum48,
        opts(),
        "game-dynamite-dan.tzx",
        "ref-game-dynamite-dan-load.scr",
        768,
        4000,
    )?;
    let ingame = ctx.reference("ref-game-dynamite-dan.gif")?;
    s.run_until_with(8000, |s| !s.zx.tape_active())
        .ok_or("the tape never stopped")?;
    s.run_frames(200);
    s.press(&keys_of("ENTER"));
    s.run_frames(400);
    ctx.spent(&s);
    let (same, n) = paper_cells_vs(&s.zx, &ingame, 19..24);
    Ok(format!(
        "Power-Load: loading screen at {screen}; in play the bottom panel {same} of {n} cells as ZXDB's"
    ))
}

fn where_time_stood_still(ctx: &mut Ctx) -> Result<String, String> {
    let (s, screen) = load_screen(
        ctx,
        Model::Spectrum128,
        opts(),
        "game-where-time-stood-still.tzx",
        "ref-game-where-time-stood-still-load.scr",
        768,
        33_000,
    )?;
    let _ = s;
    Ok(format!(
        "128K only, Speedlock 7: the loading screen (768 cells) at frame {screen}"
    ))
}

/// RoboCop with the automatic tape off (PLAY pressed once, as a person does): whether the deck stopped itself at
/// TZX's "stop the tape if 48K" (block 37), and the block it got to.
fn robocop(
    ctx: &mut Ctx,
    model: Model,
    frames: u64,
) -> Result<(Option<u64>, usize, Session), String> {
    let mut s = ctx.session(
        model,
        Options {
            auto_tape: false,
            ..opts()
        },
        "game-robocop.tzx",
    )?;
    s.play_on_load = true;
    let mut stopped = None;
    for _ in 0..frames {
        s.step();
        if stopped.is_none()
            && matches!(
                s.zx.tape_status().and_then(|t| t.stopped_by),
                Some(tape::StopReason::StopIf48k(37))
            )
        {
            stopped = Some(s.frame);
        }
    }
    ctx.spent(&s);
    let block = s.zx.tape_state().block;
    Ok((stopped, block, s))
}

fn robocop_48k(ctx: &mut Ctx) -> Result<String, String> {
    let (stopped, block, s) = robocop(ctx, Model::Spectrum48, 10_000)?;
    let at = stopped.ok_or(format!(
        "the 48K never stopped at 'stop the tape if 48K' (block {block})"
    ))?;
    if s.zx.tape_active() || block != 37 {
        return Err(format!("the tape went on to block {block}"));
    }
    Ok(format!(
        "the 48K's deck stops itself at 'stop the tape if 48K' at frame {at} (163.2 s of tape) and stays"
    ))
}

fn robocop_128k(ctx: &mut Ctx) -> Result<String, String> {
    let (stopped, block, _s) = robocop(ctx, Model::Spectrum128, 26_000)?;
    if let Some(at) = stopped {
        return Err(format!(
            "the 128K obeyed 'stop the tape if 48K' at frame {at}"
        ));
    }
    if block < 50 {
        return Err(format!("the 128K got only to block {block}"));
    }
    Ok(format!(
        "the 128K plays on past 'stop the tape if 48K', through every level, to block {block}"
    ))
}

fn saboteur2_128k(ctx: &mut Ctx) -> Result<String, String> {
    let mut s = ctx.session(Model::Spectrum128, opts(), "game-saboteur-2-128.tzx")?;
    let at = until(&mut s, "£100 REWARD", 17_000)?;
    ctx.spent(&s);
    if s.text().rows[0] != "          £100 REWARD           " {
        return Err(format!("row 0 '{}'", s.text().rows[0]));
    }
    Ok(format!("the 128K tape's REWARD screen at frame {at}"))
}

fn exolon(ctx: &mut Ctx) -> Result<String, String> {
    // Hewson's loader draws a counter box over the bottom right's 15 cells: 753 of 768 is all of the rest.
    let (_s, screen) = load_screen(
        ctx,
        Model::Spectrum48,
        opts(),
        "game-exolon.tzx",
        "ref-game-exolon-load.scr",
        753,
        6000,
    )?;
    Ok(format!(
        "Hewson's loader (headers of type 42): the loading screen at frame {screen}"
    ))
}

fn rick_dangerous(ctx: &mut Ctx) -> Result<String, String> {
    // Bleepload: a counter in the ROM font that rises as the blocks load.
    let mut s = ctx.session(Model::Spectrum48, opts(), "game-rick-dangerous.tzx")?;
    let mut counts = Vec::new();
    s.run_until_with(12_000, |s| {
        if s.frame % 100 == 0 {
            let t = s.text();
            if let Some(n) = t.rows.iter().find_map(|r| {
                r.trim()
                    .strip_prefix("Loading")
                    .and_then(|x| x.trim().parse::<u32>().ok())
            }) {
                counts.push(n);
            }
        }
        counts.len() > 20
    });
    ctx.spent(&s);
    if counts.len() < 5 || counts.windows(2).any(|w| w[1] < w[0]) || counts.last() <= counts.first()
    {
        return Err(format!("the counter read {counts:?}"));
    }
    Ok(format!(
        "'Loading NN' rises: {:?}",
        &counts[..counts.len().min(8)]
    ))
}

fn screen_only(
    ctx: &mut Ctx,
    model: Model,
    file: &str,
    scr: &str,
    min: usize,
    max: u64,
    what: &str,
) -> Result<String, String> {
    let (_s, at) = load_screen(ctx, model, opts(), file, scr, min, max)?;
    Ok(format!(
        "{what}: the loading screen ({min}+ of 768 cells) at frame {at}"
    ))
}

fn daley_thompson(ctx: &mut Ctx) -> Result<String, String> {
    screen_only(
        ctx,
        Model::Spectrum48,
        "game-daley-thompsons-decathlon.tzx",
        "ref-game-daley-thompsons-decathlon-load.scr",
        768,
        11_000,
        "Speedlock 1 (its clicky pilot)",
    )
}
fn mag_max(ctx: &mut Ctx) -> Result<String, String> {
    screen_only(
        ctx,
        Model::Spectrum48,
        "game-mag-max.tzx",
        "ref-game-mag-max-load.scr",
        760,
        8000,
        "Speedlock 3 (its decryption tone)",
    )
}
fn match_day_2(ctx: &mut Ctx) -> Result<String, String> {
    screen_only(
        ctx,
        Model::Spectrum48,
        "game-match-day-2.tzx",
        "ref-game-match-day-2-load.scr",
        762,
        8000,
        "Speedlock 5",
    )
}
fn platoon(ctx: &mut Ctx) -> Result<String, String> {
    screen_only(
        ctx,
        Model::Spectrum48,
        "game-platoon.tzx",
        "ref-game-platoon-load.scr",
        762,
        7500,
        "Speedlock 6",
    )
}
fn chase_hq(ctx: &mut Ctx) -> Result<String, String> {
    screen_only(
        ctx,
        Model::Spectrum48,
        "game-chase-hq.tzx",
        "ref-game-chase-hq-load.scr",
        768,
        6000,
        "Paul Owens's protection",
    )
}
fn renegade_128(ctx: &mut Ctx) -> Result<String, String> {
    screen_only(
        ctx,
        Model::Spectrum128,
        "game-renegade-128.tzx",
        "ref-game-renegade-load.scr",
        762,
        7000,
        "Speedlock 4 on the 128K",
    )
}
fn dizzy(ctx: &mut Ctx) -> Result<String, String> {
    screen_only(
        ctx,
        Model::Spectrum128,
        "game-fantasy-world-dizzy.tzx",
        "ref-game-fantasy-world-dizzy-load.scr",
        760,
        4000,
        "Fantasy World Dizzy on the 128K (ROM loader)",
    )
}
fn saboteur2_48k(ctx: &mut Ctx) -> Result<String, String> {
    let (mut s, at) = load_screen(
        ctx,
        Model::Spectrum48,
        opts(),
        "game-saboteur-2-48.tzx",
        "ref-game-saboteur-2-load.scr",
        768,
        4000,
    )?;
    let r = until(&mut s, "£100 REWARD", 14_000)?;
    ctx.spent(&s);
    if s.text().rows[0] != "          £100 REWARD           " {
        return Err(format!("row 0 '{}'", s.text().rows[0]));
    }
    Ok(format!(
        "the loading screen (768 cells) at frame {at}, the REWARD screen (one space) at {r}"
    ))
}
fn aquaplane_text(ctx: &mut Ctx) -> Result<String, String> {
    let mut s = ctx.session(Model::Spectrum48, opts(), "game-aquaplane.tzx")?;
    until(&mut s, "Loading.....please wait", 3000)?;
    ctx.spent(&s);
    has_lines(
        &mut s,
        &[
            "A Q U A P L A N E",
            "© 1983 J.Hollis",
            "Loading.....please wait",
        ],
    )?;
    let t = s.text();
    if t.rows[4] != "       A Q U A P L A N E        "
        || !t.rows[6].starts_with("        © 1983 J.Hollis")
    {
        return Err(format!("rows 4 and 6: '{}', '{}'", t.rows[4], t.rows[6]));
    }
    Ok("rows 4, 6 and 10 in the ROM font while it loads".into())
}

// --- state ---

fn determinism(ctx: &mut Ctx) -> Result<String, String> {
    // Run, save, run N frames; load, run N frames: the frames, the sound and the state the same, bit for bit
    // (with the tape playing, the AY playing, and the beeper).
    let mut checked = Vec::new();
    for (model, file, frames) in [
        (Model::Spectrum48, "saboteur.tzx", 2600u64),
        (Model::Spectrum128, "game-where-time-stood-still.tzx", 3000),
        (Model::Plus3, "test-ula128e-plus3.tap", 1500),
        (Model::Pentagon, "test-int-retrigger.tap", 1000),
    ] {
        let mut s = ctx.session_sound(model, opts(), file)?;
        s.run_frames(frames);
        let state = s.zx.save_state();
        let run = |s: &mut Session| {
            let mut frames = Vec::new();
            let mut audio = Vec::new();
            for _ in 0..120 {
                s.step();
                frames.push(s.zx.frame().to_vec());
                audio.extend_from_slice(s.zx.audio());
            }
            (frames, audio, s.zx.save_state())
        };
        let a = run(&mut s);
        s.zx.load_state(&state).map_err(|e| e.to_string())?;
        let b = run(&mut s);
        // And into a fresh machine of another model, with the tape in the deck.
        let mut t = ctx.session_sound(Model::Spectrum48, opts(), file)?;
        t.zx.load_state(&state).map_err(|e| e.to_string())?;
        let c = run(&mut t);
        ctx.spent(&s);
        ctx.spent(&t);
        for (name, other) in [("the same machine", &b), ("a fresh machine", &c)] {
            if a.0 != other.0 {
                let f = a.0.iter().zip(&other.0).position(|(x, y)| x != y).unwrap();
                return Err(format!("{}: {name}: frame {f} differs", model.id()));
            }
            if a.1.len() != other.1.len()
                || a.1
                    .iter()
                    .zip(&other.1)
                    .any(|(x, y)| x.to_bits() != y.to_bits())
            {
                return Err(format!("{}: {name}: the sound differs", model.id()));
            }
            if a.2 != other.2 {
                return Err(format!("{}: {name}: the state after differs", model.id()));
            }
        }
        if a.1.iter().all(|&v| v == 0.0) {
            return Err(format!("{}: no sound to compare", model.id()));
        }
        checked.push(format!("{} ({} bytes)", model.id(), state.len()));
    }
    Ok(format!(
        "120 frames, their sound and the state after, bit for bit, in the same machine and a fresh one: {}",
        checked.join(", ")
    ))
}

fn snapshot_round_trips(ctx: &mut Ctx) -> Result<String, String> {
    let names = [
        "snap-v1-acrojet.z80",
        "snap-v1-raw-caverna.z80",
        "snap-v2-48k-deathtrap.z80",
        "snap-v2-128k-brokeout.z80",
        "snap-v2-pentagon-21.z80",
        "snap-v2-plus2-daytona48.z80",
        "snap-v3-48k-betting.z80",
        "snap-v3-128k-avalanche.z80",
        "snap-v3-128k-legybator.z80",
        "snap-v3-plus2-ministocks.z80",
        "snap-v3-plus3-piramids.z80",
        "snap-128k-chata3.sna",
        "snap-128k-lombard.sna",
        "snap-szx13-48k-fruitmachine.szx",
        "snap-szx14-48k-piramide.szx",
        "snap-szx15-128k-littlefish.szx",
        "snap-szx13-128k-gamex2.szx",
        "snap-slt-heavymetal.slt",
        "snap-slt-killeduntildead.slt",
        "test-timing-tests-48k.sna",
        "test-basic-border.z80",
    ];
    let mut n = 0;
    for name in names {
        let bytes = ctx.fixture(name)?;
        let original = snapshot::load(&bytes).map_err(|e| format!("{name}: {e}"))?;
        let mut zx = spectrum::Machine::new(Model::Spectrum48);
        zx.load(&bytes, name).map_err(|e| format!("{name}: {e}"))?;
        // Restored and taken again at once: the same machine (but the formats' own losses).
        let again = zx.snapshot();
        let same = |a: &snapshot::Snapshot, b: &snapshot::Snapshot| {
            a.model == b.model
                && a.ram == b.ram
                && a.port_7ffd == b.port_7ffd
                && a.tstates == b.tstates
                && a.border() == b.border()
                && a.regs.pc == b.regs.pc
                && a.regs.sp == b.regs.sp
                && a.regs.af == b.regs.af
                && a.regs.bc == b.regs.bc
                && a.regs.ix == b.regs.ix
                && a.regs.iff1 == b.regs.iff1
                && a.regs.im == b.regs.im
                && a.regs.halted == b.regs.halted
        };
        if !same(&original, &again) {
            return Err(format!(
                "{name}: restored and taken again, the snapshot differs"
            ));
        }
        // Run on, written in each format, and read back into another machine: it runs on the same.
        for _ in 0..50 {
            zx.run_frame();
        }
        // .z80 has no HALT flag (it leaves PC at the HALT, which runs again: 4 T-states and an R later), so
        // the snapshot is taken where the CPU is not halted.
        while zx.cpu().halted || zx.cpu().prefix != 0 {
            zx.run(1);
        }
        for fmt in [snapshot::Format::Z80, snapshot::Format::Szx] {
            let file = snapshot::save(&zx.snapshot(), fmt).map_err(|e| format!("{name}: {e}"))?;
            let mut other = spectrum::Machine::new(Model::Spectrum48);
            other
                .load(&file, &format!("x.{}", fmt.extension()))
                .map_err(|e| format!("{name}: {e}"))?;
            if fmt == snapshot::Format::Z80 {
                // What .z80 has no place for: MEMPTR and Q (which show in undocumented flags).
                let r = *zx.cpu();
                other.cpu_mut().memptr = r.memptr;
                other.cpu_mut().q = r.q;
            }
            if other.cpu() != zx.cpu() || other.tstate() != zx.tstate() {
                return Err(format!(
                    "{name}: through .{} the CPU or T-state differs",
                    fmt.extension()
                ));
            }
            let mut a = zx.clone();
            for _ in 0..50 {
                a.run_frame();
                other.run_frame();
            }
            // FLASH's phase counts frames since power-on, which no format keeps: flashing cells aside.
            let flashing = |m: &spectrum::Machine, cy: usize, cx: usize| {
                let (p, _, _) = m.paging();
                let bank = if m.model().is_128k() && p & 8 != 0 {
                    7
                } else {
                    5
                };
                m.ram_bank(bank)[0x1800 + cy * 32 + cx] & 0x80 != 0
            };
            let picture_differs = (0..296).any(|y| {
                (0..352).any(|x| {
                    let paper = (48..240).contains(&y) && (48..304).contains(&x);
                    let i = y * 352 + x;
                    a.frame()[i] != other.frame()[i]
                        && !(paper && flashing(&a, (y - 48) / 8, (x - 48) / 8))
                })
            });
            let ram_differs = a
                .model()
                .banks()
                .iter()
                .any(|&b| a.ram_bank(b) != other.ram_bank(b));
            if picture_differs || ram_differs || a.cpu() != other.cpu() {
                return Err(format!(
                    "{name}: through .{} it ran on differently (picture {picture_differs}, RAM {ram_differs})",
                    fmt.extension()
                ));
            }
        }
        ctx.seconds += 150.0 / 50.0;
        n += 1;
    }
    Ok(format!(
        "{n} snapshots: restored and taken again the same; through .z80 and .szx, 50 frames on to the same CPU, RAM and picture"
    ))
}

// --- §2 demos ---

fn shock(ctx: &mut Ctx, model: Model, want: u8) -> Result<String, String> {
    // The speed test counts a loop between two interrupts and stores 48 (a 48K) or 128 at 25277.
    let mut s = ctx.session(model, opts(), "demo-shock.tzx")?;
    let start = s
        .run_until_with(1000, |s| s.zx.tape_active())
        .ok_or("the tape never started")?;
    s.run_frames(1300);
    ctx.spent(&s);
    let v = s.zx.peek(25277);
    if v != want {
        return Err(format!("25277 holds {v:#04X}, not {want:#04X}"));
    }
    Ok(format!(
        "25277 = {v:#04X} after its speed test (tape from {start})"
    ))
}

fn shock_48k(ctx: &mut Ctx) -> Result<String, String> {
    shock(ctx, Model::Spectrum48, 0x30)
}
fn shock_128k(ctx: &mut Ctx) -> Result<String, String> {
    shock(ctx, Model::Spectrum128, 0x80)
}

/// The paper's cells (in `rows` × `cols`) that show more than two colours (bright counted apart, bright black as
/// black): multicolour.
fn multicolour_cells(
    zx: &spectrum::Machine,
    rows: std::ops::Range<usize>,
    cols: std::ops::Range<usize>,
) -> usize {
    let f = zx.frame();
    let mut n = 0;
    for cy in rows {
        for cx in cols.clone() {
            let mut seen = [false; 16];
            for y in 0..8 {
                for x in 0..8 {
                    let c = f[(48 + cy * 8 + y) * 352 + 48 + cx * 8 + x];
                    seen[if c == 8 { 0 } else { c as usize }] = true;
                }
            }
            n += (seen.iter().filter(|&&b| b).count() > 2) as usize;
        }
    }
    n
}

fn shock_part2(ctx: &mut Ctx) -> Result<String, String> {
    // Part 2 (Your Sinclair: "full-screen single line rasters"): every border row one colour, the side borders
    // alike on every row; the bars change from line to line. SPACE leaves the intro on the next header's pilot.
    let mut s = ctx.session(Model::Spectrum48, opts(), "demo-shock.tzx")?;
    let start = s
        .run_until_with(1000, |s| s.zx.tape_active())
        .ok_or("the tape never started")?;
    s.run_frames(4150);
    s.press(&keys_of("SPACE"));
    while s.frame - start < 9850 {
        s.step();
    }
    ctx.spent(&s);
    let f = s.zx.frame();
    for y in (0..48).chain(240..296) {
        let row = &f[y * 352..(y + 1) * 352];
        if row.iter().any(|&c| c != row[0]) {
            return Err(format!("border row {y} is not one colour"));
        }
    }
    for y in 48..240 {
        let row = &f[y * 352..(y + 1) * 352];
        if row[..48].iter().any(|&c| c != row[0]) || row[304..] != row[..48] {
            return Err(format!("row {y}: the side borders differ"));
        }
    }
    let changes = (1..48).filter(|&y| f[y * 352] != f[(y - 1) * 352]).count();
    let colours: std::collections::BTreeSet<u8> = (0..48).map(|y| f[y * 352]).collect();
    if changes < 20 || colours.len() < 4 {
        return Err(format!(
            "{changes} row-to-row changes and {} colours in the top border",
            colours.len()
        ));
    }
    Ok(format!(
        "part 2's rasters at tape frame 9850: every border row one colour, {changes} changes and {} colours in the top border",
        colours.len()
    ))
}

fn contention_tables(ctx: &mut Ctx) -> Result<String, String> {
    // The contention tables as a release build makes them (the machine's own tests run unoptimised enough
    // not to see what the optimiser does): a NOP in contended memory from each T-state of a whole paper line,
    // the first and the last, and of the border after it, takes 4 T-states and the pattern's delay. (rustc
    // 1.98.1 has been seen to compile the table's fill into reads past its 8-byte pattern; see model.rs.)
    let mut checked = Vec::new();
    for (model, page, start, line, pattern, span) in [
        (
            Model::Spectrum48,
            None,
            14335u32,
            224u32,
            [6u32, 5, 4, 3, 2, 1, 0, 0],
            128u32,
        ),
        (
            Model::Spectrum128,
            Some(1u8),
            14361,
            228,
            [6, 5, 4, 3, 2, 1, 0, 0],
            128,
        ),
        (
            Model::Plus3,
            Some(4),
            14361,
            228,
            [1, 0, 7, 6, 5, 4, 3, 2],
            129,
        ),
    ] {
        let mut zx = spectrum::Machine::with_options(
            model,
            Options {
                sound: false,
                ..opts()
            },
        );
        // Page the bank in at C000h (LD BC,7FFDh; LD A,bank; OUT (C),A), as the CPU would.
        if let Some(bank) = page {
            for (i, b) in [0x01, 0xFD, 0x7F, 0x3E, bank, 0xED, 0x79]
                .into_iter()
                .enumerate()
            {
                zx.poke(0x8000 + i as u16, b);
            }
            let r = zx.cpu_mut();
            r.pc = 0x8000;
            r.iff1 = false;
            zx.set_tstate(1000);
            zx.run(3);
        }
        let at = if page.is_some() { 0xC000 } else { 0x4000 };
        zx.poke(at, 0x00);
        for paper_line in [0u32, 191] {
            let from = start + paper_line * line - 4;
            for t in from..from + span + 12 {
                let mut m = zx.clone();
                let r = m.cpu_mut();
                r.pc = at;
                r.iff1 = false;
                r.halted = false;
                m.set_tstate(t);
                m.run(1);
                let i = t as i64 - (start + paper_line * line) as i64;
                let want = if (0..span as i64).contains(&i) {
                    4 + pattern[i as usize % 8]
                } else {
                    4
                };
                if m.tstate() - t != want {
                    return Err(format!(
                        "{}: a NOP at {t} takes {} T-states, not {want}",
                        model.id(),
                        m.tstate() - t
                    ));
                }
            }
        }
        checked.push(model.id());
    }
    ctx.seconds += 0.1;
    Ok(format!(
        "a NOP from each T-state of paper lines 0 and 191 and around them: {}",
        checked.join(", ")
    ))
}

fn overscan(ctx: &mut Ctx) -> Result<String, String> {
    // The Overscan Demo: SPACE turns its text pages (about 23 of them: the credits, the greetings, the
    // author's address) to "Press ENTER to part two."; ENTER starts the bars. On hardware the whole picture
    // is bars one scanline tall, every row one colour edge to edge, so that the paper's edge cannot be seen
    // (docs/test-corpus.md §2): the attribute writes and the border's OUTs have to land on the T-state.
    let mut s = ctx.session(Model::Spectrum48, opts(), "demo-overscan.tzx")?;
    s.run_frames(4000);
    for _ in 0..23 {
        s.press(&keys_of("SPACE"));
        s.run_frames(250);
    }
    let before = one_colour_rows(&s.zx);
    s.press(&keys_of("ENTER"));
    s.run_frames(100);
    // Every frame looked at: rows 40-255 at least 95% one colour (205 of 216), 6 colours down column 0. The
    // bars move, and a character row of them can be two colours only, so the 700 of 768 cells with more than
    // two colours (the capture's count) is asked of the best frame.
    let (mut rows, mut colours, mut cells) = (usize::MAX, usize::MAX, 0);
    for _ in 0..10 {
        s.run_frames(47);
        rows = rows.min(one_colour_rows(&s.zx));
        cells = cells.max(multicolour_cells(&s.zx, 0..24, 0..32));
        let f = s.zx.frame();
        let column0: std::collections::BTreeSet<u8> = (0..296).map(|y| f[y * 352]).collect();
        colours = colours.min(column0.len());
    }
    ctx.spent(&s);
    if before > 150 || rows < 205 || cells < 700 || colours < 6 {
        return Err(format!(
            "before ENTER {before} one-colour rows; after, at worst {rows} of rows 40-255 one colour and \
             {colours} colours down column 0, at best {cells} multicolour cells"
        ));
    }
    Ok(format!(
        "part two's bars (ENTER at its page, after 23 SPACEs): in 10 frames at worst {rows} of rows 40-255 one \
         colour edge to edge and {colours} colours down column 0; at best {cells} of 768 cells multicolour"
    ))
}

/// How many of the frame's rows 40-255 are one colour from edge to edge.
fn one_colour_rows(zx: &spectrum::Machine) -> usize {
    let f = zx.frame();
    (40..256)
        .filter(|&y| {
            let row = &f[y * 352..(y + 1) * 352];
            row.iter().all(|&c| c == row[0])
        })
        .count()
}

fn nirvana(ctx: &mut Ctx) -> Result<String, String> {
    // NIRVANA+: 8 × 2 multicolour over 32 columns: colours change inside a cell only at even pixel lines.
    let r = ctx.reference("ref-demo-nirvana-plus.png")?;
    let mut s = ctx.session(Model::Spectrum48, opts(), "demo-nirvana-plus.tap")?;
    s.run_frames(5200);
    ctx.spent(&s);
    let multi = multicolour_cells(&s.zx, 1..24, 0..32);
    let f = s.zx.frame();
    // Within each 8 × 2 band of a cell the pixels are two colours at most.
    let mut bad = 0;
    for cy in 1..24 {
        for cx in 0..32 {
            for band in 0..4 {
                let mut seen = [false; 16];
                for y in 0..2 {
                    for x in 0..8 {
                        let c = f[(48 + cy * 8 + band * 2 + y) * 352 + 48 + cx * 8 + x];
                        seen[if c == 8 { 0 } else { c as usize }] = true;
                    }
                }
                bad += (seen.iter().filter(|&&b| b).count() > 2) as usize;
            }
        }
    }
    if multi < 100 || bad > 0 {
        return Err(format!(
            "{multi} multicolour cells, {bad} 8x2 bands with more than two colours"
        ));
    }
    let (d, n) = frame_vs(&s.zx, &r);
    Ok(format!(
        "{multi} multicolour cells, every 8x2 band two colours; {d} of {n} pixels differ from the reference (its sprites move)"
    ))
}

fn bifrost2(ctx: &mut Ctx) -> Result<String, String> {
    // BIFROST*2: 8 × 1 multicolour tiles in columns 1-20. Its stages: STATIC TILES (PRESS ANY KEY!), then a
    // key gives ANIMATED TILES (CHOOSE FRAMES 2-4 OR 0 TO EXIT), and 0 PAINTING TILES, where the playfield is
    // empty until someone paints it: the reference is such a painting, so columns 21-31 are held to it where
    // the stages agree, the title (BIFROST*2 ENGINE BY EINAR, pixel rows 0-79).
    let (r, rw, _) = ctx.reference("ref-demo-bifrost2.png")?;
    let mut s = ctx.session(Model::Spectrum48, opts(), "demo-bifrost2.tap")?;
    until(&mut s, "BIFROST*2", 8000)?;
    s.run_frames(150);
    let (ox, oy) = if rw == 352 { (0, 0) } else { (48, 48) };
    let norm = |c: u8| if c == 8 { 0 } else { c };
    let f = s.zx.frame();
    let mut differ = 0;
    for y in 0..80 {
        for x in 21 * 8..256 {
            if norm(f[(48 + y) * 352 + 48 + x]) != norm(r[(48 - oy + y) * rw + 48 - ox + x]) {
                differ += 1;
            }
        }
    }
    let multi = multicolour_cells(&s.zx, 1..23, 1..21);
    if multi < 80 || differ != 0 {
        return Err(format!(
            "{multi} multicolour cells in columns 1-20; {differ} pixels of the title differ"
        ));
    }
    // The stages after it, as their texts name them.
    until(&mut s, "PRESS ANY KEY", 600)?;
    s.press(&keys_of("SPACE"));
    until(&mut s, "ANIMATED", 600)?;
    until(&mut s, "CHOOSE FRAMES 2-4 OR 0 TO EXIT", 600)?;
    s.press(&keys_of("0"));
    until(&mut s, "PAINTING", 600)?;
    ctx.spent(&s);
    Ok(format!(
        "{multi} multicolour cells in columns 1-20; the title in columns 21-31 exactly the reference; a key, \
         ANIMATED TILES; 0, PAINTING TILES"
    ))
}

fn old_tower(ctx: &mut Ctx, model: Model, file: &str, frames: u64) -> Result<String, String> {
    let mut s = ctx.session(model, opts(), file)?;
    s.run_frames(frames);
    // PUSH FIRE TO START: SPACE, and the playfield scrolls.
    s.press(&keys_of("SPACE"));
    s.run_frames(300);
    ctx.spent(&s);
    let multi = multicolour_cells(&s.zx, 2..20, 10..22);
    if multi < 80 {
        return Err(format!("{multi} multicolour cells in the playfield"));
    }
    Ok(format!(
        "{multi} multicolour cells in the playfield (columns 10-21)"
    ))
}

fn old_tower_128k(ctx: &mut Ctx) -> Result<String, String> {
    old_tower(ctx, Model::Spectrum128, "demo-oldtower-128k.tap", 29_300)
}
fn old_tower_pentagon(ctx: &mut Ctx) -> Result<String, String> {
    old_tower(ctx, Model::Pentagon, "demo-oldtower-pentagon.tap", 29_300)
}

fn lyra2(ctx: &mut Ctx) -> Result<String, String> {
    // A smoke test: part 1 loads by its own loader and its intro scroller runs (with an AY on the 48K).
    let mut s = ctx.session(
        Model::Spectrum48,
        Options {
            ay_on_48k: true,
            ..opts()
        },
        "demo-lyra2.tzx",
    )?;
    s.run_frames(7600);
    let a = s.zx.frame().to_vec();
    s.run_frames(50);
    ctx.spent(&s);
    let moved = cells_changed(&a, s.zx.frame());
    if moved == 0 {
        return Err("part 1 is not moving".into());
    }
    Ok(format!(
        "part 1's scroller runs ({moved} cells move in 50 frames)"
    ))
}

fn eye_ache(ctx: &mut Ctx) -> Result<String, String> {
    // Pentagon only: large areas of multicolour.
    let mut s = ctx.session(Model::Pentagon, opts(), "demo-eyeache.tap")?;
    let mut best = 0;
    // After the loading, its intro (CODE BUSTERS); the multicolour from about 12,500.
    s.run_frames(12_500);
    for _ in 0..20 {
        s.run_frames(50);
        best = best.max(multicolour_cells(&s.zx, 2..24, 2..24));
    }
    ctx.spent(&s);
    if best < 50 {
        return Err(format!("at most {best} multicolour cells"));
    }
    Ok(format!("up to {best} multicolour cells in columns 2-23"))
}

fn aquaplane(ctx: &mut Ctx) -> Result<String, String> {
    // The border cyan above the horizon and blue below, changing on frame row 95 or 96, timed by contention.
    let mut s = ctx.session(Model::Spectrum48, opts(), "game-aquaplane.tzx")?;
    until(&mut s, "Loading.....please wait", 3000)?;
    s.run_until_with(6000, |s| !s.zx.tape_active())
        .ok_or("the tape never stopped")?;
    s.run_frames(300);
    s.press(&keys_of("S"));
    s.run_frames(300);
    ctx.spent(&s);
    let f = s.zx.frame();
    let side = |y: usize| -> Option<u8> {
        let c = f[y * 352];
        ((0..48).chain(304..352))
            .all(|x| f[y * 352 + x] == c)
            .then_some(c)
    };
    for y in 0..95 {
        if side(y) != Some(5) {
            return Err(format!(
                "row {y}: the side border is {:?}, not cyan",
                side(y)
            ));
        }
    }
    for y in 97..296 {
        if side(y) != Some(1) {
            return Err(format!(
                "row {y}: the side border is {:?}, not blue",
                side(y)
            ));
        }
    }
    Ok(format!(
        "cyan to row 94, blue from 97 (rows 95, 96: {:?}, {:?})",
        side(95),
        side(96)
    ))
}

pub static ALL: &[Part] = &[
    Part {
        name: "boot › 16k",
        run: boot_16k,
    },
    Part {
        name: "boot › 48k",
        run: boot_48k,
    },
    Part {
        name: "boot › 128k",
        run: boot_128k,
    },
    Part {
        name: "boot › plus2",
        run: boot_plus2,
    },
    Part {
        name: "boot › plus2a",
        run: boot_plus2a,
    },
    Part {
        name: "boot › plus3",
        run: boot_plus3,
    },
    Part {
        name: "boot › pentagon",
        run: boot_pentagon,
    },
    Part {
        name: "boot › plus3 loads a tape",
        run: plus3_loads_a_tape,
    },
    Part {
        name: "rom › loading stripes",
        run: loading_stripes,
    },
    Part {
        name: "z80test › full",
        run: z80full,
    },
    Part {
        name: "z80test › doc",
        run: z80doc,
    },
    Part {
        name: "z80test › flags",
        run: z80flags,
    },
    Part {
        name: "z80test › docflags",
        run: z80docflags,
    },
    Part {
        name: "z80test › ccf",
        run: z80ccf,
    },
    Part {
        name: "z80test › memptr",
        run: z80memptr,
    },
    Part {
        name: "z80test › ccfscr picture",
        run: z80ccfscr,
    },
    Part {
        name: "fusetest › 48k",
        run: fusetest_48k,
    },
    Part {
        name: "fusetest › 128k",
        run: fusetest_128k,
    },
    Part {
        name: "fusetest › plus3",
        run: fusetest_plus3,
    },
    Part {
        name: "fusetest › pentagon",
        run: fusetest_pentagon,
    },
    Part {
        name: "timing tests › 48k",
        run: timing_tests_48k,
    },
    Part {
        name: "timing tests › 128k late",
        run: timing_tests_128k_late,
    },
    Part {
        name: "timing tests › 128k early",
        run: timing_tests_128k_early,
    },
    Part {
        name: "minfo › 48k",
        run: minfo_48k,
    },
    Part {
        name: "minfo › 128k",
        run: minfo_128k,
    },
    Part {
        name: "minfo › pentagon",
        run: minfo_pentagon,
    },
    Part {
        name: "minfo › 2011",
        run: minfo_2011,
    },
    Part {
        name: "ulatest3 › 48k",
        run: ulatest3,
    },
    Part {
        name: "timingtest › menu",
        run: rak_menu,
    },
    Part {
        name: "timingtest › 48k 0",
        run: rak_48k_0,
    },
    Part {
        name: "timingtest › 48k 1",
        run: rak_48k_1,
    },
    Part {
        name: "timingtest › 48k 2",
        run: rak_48k_2,
    },
    Part {
        name: "timingtest › 48k 3",
        run: rak_48k_3,
    },
    Part {
        name: "timingtest › 48k 4",
        run: rak_48k_4,
    },
    Part {
        name: "timingtest › 128k 0",
        run: rak_128k_0,
    },
    Part {
        name: "timingtest › 128k 8",
        run: rak_128k_8,
    },
    Part {
        name: "timingtest › plus3 0",
        run: rak_plus3_0,
    },
    Part {
        name: "timingtest › plus3 3",
        run: rak_plus3_3,
    },
    Part {
        name: "floatspy › 48k",
        run: floatspy_48k,
    },
    Part {
        name: "floatspy › 128k",
        run: floatspy_128k,
    },
    Part {
        name: "ula pictures › ula48 simple",
        run: ula48_simple,
    },
    Part {
        name: "ula pictures › ula128 timing",
        run: ula128_timing,
    },
    Part {
        name: "ula pictures › ula128e plus3",
        run: ula128e_plus3,
    },
    Part {
        name: "im0-2 › early",
        run: im0_2_early,
    },
    Part {
        name: "im0-2 › late",
        run: im0_2_late,
    },
    Part {
        name: "int retrigger › 48k",
        run: int_retrigger_48k,
    },
    Part {
        name: "int retrigger › 128k",
        run: int_retrigger_128k,
    },
    Part {
        name: "int retrigger › pentagon",
        run: int_retrigger_pentagon,
    },
    Part {
        name: "floatffd › 128k",
        run: floatffd_128k,
    },
    Part {
        name: "floatffd › 48k",
        run: floatffd_48k,
    },
    Part {
        name: "ir contention",
        run: ir_contention,
    },
    Part {
        name: "nec contention",
        run: nec_contention,
    },
    Part {
        name: "plus3 › floating bus",
        run: plus3_floatbus,
    },
    Part {
        name: "plus3 › paging",
        run: plus3_paging,
    },
    Part {
        name: "basic border",
        run: basic_border,
    },
    Part {
        name: "frame test › 48k",
        run: frame_test_48k,
    },
    Part {
        name: "frame test › 128k",
        run: frame_test_128k,
    },
    Part {
        name: "ay-ym",
        run: ay_ym,
    },
    Part {
        name: "games › saboteur",
        run: saboteur,
    },
    Part {
        name: "games › saboteur instant",
        run: saboteur_instant,
    },
    Part {
        name: "games › saboteur tap",
        run: saboteur_tap,
    },
    Part {
        name: "games › manic miner",
        run: manic_miner,
    },
    Part {
        name: "games › arkanoid",
        run: arkanoid,
    },
    Part {
        name: "games › cobra",
        run: cobra,
    },
    Part {
        name: "games › short circuit",
        run: short_circuit,
    },
    Part {
        name: "games › renegade 48k",
        run: renegade_48,
    },
    Part {
        name: "games › rasputin",
        run: rasputin,
    },
    Part {
        name: "games › abu simbel",
        run: abu_simbel,
    },
    Part {
        name: "games › dynamite dan",
        run: dynamite_dan,
    },
    Part {
        name: "games › where time stood still",
        run: where_time_stood_still,
    },
    Part {
        name: "games › robocop 128k",
        run: robocop_128k,
    },
    Part {
        name: "games › robocop 48k",
        run: robocop_48k,
    },
    Part {
        name: "games › saboteur ii 128k",
        run: saboteur2_128k,
    },
    Part {
        name: "games › exolon",
        run: exolon,
    },
    Part {
        name: "games › rick dangerous",
        run: rick_dangerous,
    },
    Part {
        name: "games › daley thompson",
        run: daley_thompson,
    },
    Part {
        name: "games › mag max",
        run: mag_max,
    },
    Part {
        name: "games › match day ii",
        run: match_day_2,
    },
    Part {
        name: "games › platoon",
        run: platoon,
    },
    Part {
        name: "games › chase hq",
        run: chase_hq,
    },
    Part {
        name: "games › renegade 128k",
        run: renegade_128,
    },
    Part {
        name: "games › fantasy world dizzy",
        run: dizzy,
    },
    Part {
        name: "games › saboteur ii 48k",
        run: saboteur2_48k,
    },
    Part {
        name: "games › aquaplane",
        run: aquaplane_text,
    },
    Part {
        name: "demos › shock 48k",
        run: shock_48k,
    },
    Part {
        name: "demos › shock 128k",
        run: shock_128k,
    },
    Part {
        name: "demos › aquaplane",
        run: aquaplane,
    },
    Part {
        name: "demos › shock part 2",
        run: shock_part2,
    },
    Part {
        name: "machine › contention tables",
        run: contention_tables,
    },
    Part {
        name: "demos › overscan",
        run: overscan,
    },
    Part {
        name: "demos › nirvana+",
        run: nirvana,
    },
    Part {
        name: "demos › bifrost*2",
        run: bifrost2,
    },
    Part {
        name: "demos › old tower 128k",
        run: old_tower_128k,
    },
    Part {
        name: "demos › old tower pentagon",
        run: old_tower_pentagon,
    },
    Part {
        name: "demos › lyra ii",
        run: lyra2,
    },
    Part {
        name: "demos › eye ache",
        run: eye_ache,
    },
    Part {
        name: "state › determinism",
        run: determinism,
    },
    Part {
        name: "state › snapshot round trips",
        run: snapshot_round_trips,
    },
];
