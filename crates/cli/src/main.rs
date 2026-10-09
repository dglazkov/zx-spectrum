//! `zx`: the emulator headless. `zx --help` and `zx COMMAND --help` say what each command does.

use std::process::ExitCode;
use std::time::Instant;

use serde_json::{Value, json};
use spectrum::{AyStereo, Joystick, Machine, Model, Options};
use zx_cli::image;
use zx_cli::script::{Action, Session, When, parse_keys};

const HELP: &str = "zx: a ZX Spectrum, headless

  zx run [FILE...] [options]     run a machine: load files, press keys, take pictures, read the screen
  zx tape FILE [--json]          the blocks of a tape (TAP, TZX, CSW, PZX, or a zip of one)
  zx snap FILE [--json]          what a snapshot holds (.z80, .sna, .szx, .slt, or a zip of one)
  zx disasm [FILE] [options]     disassemble a ROM, a snapshot's memory, or a binary
  zx screen FILE.scr [options]   a screen dump as a picture, or as text
  zx bench [options]             how fast each model runs, natively
  zx compare A B [options]       two pictures (PNG, GIF) compared by Spectrum colour number

`zx COMMAND --help` for each. Every command takes --json, and then prints one JSON value.";

const RUN_HELP: &str = "zx run [FILE...] [options]

Runs a machine headless. Files load in order: a snapshot switches the machine to its model; a tape goes in
the deck, and LOAD \"\" (or the 128's Tape Loader) is typed once the ROM is ready, unless --no-load.

Machine (these win over what a snapshot or state says, but for the model, which a snapshot or state sets):
  --model M            16k, 48k (default), 128k, plus2, plus2a, plus3, pentagon; 48k-issue2, 48k-late, ...
  --issue2             an Issue 2 keyboard (16K/48K)
  --late, --early      late (or early) ULA timings (16K, 48K, 128K, +2)
  --ay48               an AY on a 16K/48K
  --no-snow            no ULA snow
  --joystick KIND      kempston, sinclair1, sinclair2, cursor
  --stereo S           mono, abc, acb
Tape:
  --tape STYLE         realtime (default; the edges played), instant (ROM blocks loaded at once by the
                       LD-BYTES trap, the rest played), flat (as realtime: zx always runs flat out)
  --no-auto-tape       no automatic start and stop: PLAY is pressed when LOAD is typed (or --play F)
  --play F             press PLAY at frame F;  --stop F  press STOP at frame F
  --no-load            do not type LOAD \"\"
Script (frames count from the start of the run):
  --key F=KEYS         press keys at frame F, each held 5 frames, 5 apart: ENTER, SS+P, \"1 0\", CS+5,CS+5;
                       KEYS/N holds each N frames
  --type F=TEXT        type TEXT at frame F at the ROM's pace (\\n is ENTER)
  --when TEXT=KEYS     press KEYS whenever the screen shows TEXT (scroll?=ENTER); --when-row R limits the
                       last --when to row R
  --shot F=PATH        a PNG of frame F
  --frames N           run N frames (after --until-text, if given; default 100 without it)
  --until-text TEXT    run until the screen shows TEXT, at most --max-frames (default 20000); exit 1 if not
Output:
  --png PATH           the last frame as a PNG (352 x 296, the paper at 48,48); --scale N
  --text               the screen read as text, against the ROM font (inverse cells too)
  --peek ADDR          a byte of memory at the end (hex as 0x5B00 or $5B00, or decimal); repeatable
  --wav PATH           the sound of the whole run
  --save-snapshot PATH a .z80, .sna or .szx at the end
  --save-state PATH    the machine's own state at the end; --load-state PATH to start from one
  --json               one JSON value: frames, text, peeks, tape, pictures
Looking into a program:
  --profile N          sample PC N times a frame: where the program spends its time (with disassembly)
  --trace-ports [M=]V  every port write whose address AND M (FFFF if not given) is V: frame, T-state, value
  --tape-log           what was done to the tape (played, stopped, blocks taken at once), frame by frame";

fn parse_num(s: &str) -> Result<u64, String> {
    let s = s.trim();
    let r = if let Some(h) = s.strip_prefix("0x").or_else(|| s.strip_prefix('$')) {
        u64::from_str_radix(h, 16)
    } else if let Some(h) = s.strip_suffix('h').or_else(|| s.strip_suffix('H')) {
        u64::from_str_radix(h, 16)
    } else {
        s.replace(['_', ','], "").parse()
    };
    r.map_err(|_| format!("not a number: {s}"))
}

fn split_eq(s: &str) -> Result<(&str, &str), String> {
    s.split_once('=')
        .ok_or_else(|| format!("expected X=Y, got {s}"))
}

struct Args {
    items: Vec<String>,
    at: usize,
}

impl Args {
    fn next(&mut self) -> Option<String> {
        let a = self.items.get(self.at).cloned();
        self.at += 1;
        a
    }
    fn value(&mut self, flag: &str) -> Result<String, String> {
        self.next().ok_or_else(|| format!("{flag} needs a value"))
    }
}

fn parse_model(s: &str, options: &mut Options) -> Result<Model, String> {
    let lower = s.to_ascii_lowercase();
    let mut base = lower.as_str();
    for (suffix, apply) in [("-issue2", 0), ("-issue3", 1), ("-late", 2), ("-early", 3)] {
        if let Some(b) = base.strip_suffix(suffix) {
            base = b;
            match apply {
                0 => options.issue2 = true,
                1 => options.issue2 = false,
                2 => options.late_timings = true,
                _ => options.late_timings = false,
            }
        }
    }
    // A second suffix (48k-issue2-late).
    for (suffix, apply) in [("-issue2", 0), ("-late", 2)] {
        if let Some(b) = base.strip_suffix(suffix) {
            base = b;
            if apply == 0 {
                options.issue2 = true
            } else {
                options.late_timings = true
            }
        }
    }
    Model::from_id(base).ok_or_else(|| format!("no model '{s}'"))
}

/// Options given on the command line, which override what a loaded snapshot or state says.
#[derive(Default)]
struct Forced {
    issue2: Option<bool>,
    late: Option<bool>,
    snow: Option<bool>,
    ay48: Option<bool>,
}

fn cmd_run(mut args: Args) -> Result<ExitCode, String> {
    let mut options = Options::default();
    let mut model = Model::Spectrum48;
    let mut files = Vec::new();
    let mut frames: Option<u64> = None;
    let mut until: Option<String> = None;
    let mut max_frames = 20_000u64;
    let mut no_load = false;
    let mut at: Vec<(u64, Action)> = Vec::new();
    let mut when: Vec<When> = Vec::new();
    let (mut png, mut scale, mut text, mut json_out) = (None, 1usize, false, false);
    let mut peeks = Vec::new();
    let (mut wav, mut save_snap, mut save_state, mut load_state) = (None, None, None, None);
    let mut joystick: Option<Joystick> = None;
    let mut no_auto = false;
    let mut model_set = false;
    let mut forced = Forced::default();
    let mut profile: Option<u32> = None;
    let mut trace: Option<(u16, u16)> = None;
    let mut tape_log = false;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!("{RUN_HELP}");
                return Ok(ExitCode::SUCCESS);
            }
            "--model" => {
                let before = options;
                model = parse_model(&args.value(&a)?, &mut options)?;
                if options.issue2 != before.issue2 {
                    forced.issue2 = Some(options.issue2);
                }
                if options.late_timings != before.late_timings {
                    forced.late = Some(options.late_timings);
                }
                model_set = true;
            }
            "--issue2" => {
                options.issue2 = true;
                forced.issue2 = Some(true);
            }
            "--late" => {
                options.late_timings = true;
                forced.late = Some(true);
            }
            "--early" => {
                options.late_timings = false;
                forced.late = Some(false);
            }
            "--ay48" => {
                options.ay_on_48k = true;
                forced.ay48 = Some(true);
            }
            "--no-snow" => {
                options.snow = false;
                forced.snow = Some(false);
            }
            "--joystick" => {
                let v = args.value(&a)?;
                joystick = Some(Joystick::from_id(&v).ok_or_else(|| format!("no joystick '{v}'"))?);
            }
            "--stereo" => {
                let v = args.value(&a)?;
                options.ay_stereo =
                    AyStereo::from_id(&v).ok_or_else(|| format!("no stereo '{v}'"))?;
            }
            "--tape" => match args.value(&a)?.as_str() {
                "realtime" | "flat" | "real" => options.instant_load = false,
                "instant" => options.instant_load = true,
                v => return Err(format!("no tape style '{v}'")),
            },
            "--no-auto-tape" => no_auto = true,
            "--play" => at.push((parse_num(&args.value(&a)?)?, Action::Play)),
            "--stop" => at.push((parse_num(&args.value(&a)?)?, Action::Stop)),
            "--no-load" => no_load = true,
            "--key" => {
                let v = args.value(&a)?;
                let (f, k) = split_eq(&v)?;
                at.push((parse_num(f)?, parse_keys(k)?));
            }
            "--type" => {
                let v = args.value(&a)?;
                let (f, t) = split_eq(&v)?;
                at.push((parse_num(f)?, Action::Type(t.replace("\\n", "\n"))));
            }
            "--when" => {
                let v = args.value(&a)?;
                let (t, k) = v.rsplit_once('=').ok_or("expected TEXT=KEYS")?;
                when.push(When::new(t, parse_keys(k)?));
            }
            "--when-row" => {
                let r = parse_num(&args.value(&a)?)? as usize;
                when.last_mut().ok_or("--when-row after --when")?.row = Some(r);
            }
            "--shot" => {
                let v = args.value(&a)?;
                let (f, p) = split_eq(&v)?;
                at.push((parse_num(f)?, Action::Png(p.to_string())));
            }
            "--frames" => frames = Some(parse_num(&args.value(&a)?)?),
            "--until-text" => until = Some(args.value(&a)?),
            "--max-frames" => max_frames = parse_num(&args.value(&a)?)?,
            "--png" => png = Some(args.value(&a)?),
            "--scale" => scale = parse_num(&args.value(&a)?)? as usize,
            "--text" => text = true,
            "--peek" => peeks.push(parse_num(&args.value(&a)?)? as u16),
            "--wav" => wav = Some(args.value(&a)?),
            "--save-snapshot" => save_snap = Some(args.value(&a)?),
            "--save-state" => save_state = Some(args.value(&a)?),
            "--load-state" => load_state = Some(args.value(&a)?),
            "--json" => json_out = true,
            "--profile" => profile = Some(parse_num(&args.value(&a)?)? as u32),
            "--trace-ports" => {
                let v = args.value(&a)?;
                let (m, val) = v.split_once('=').unwrap_or((v.as_str(), v.as_str()));
                let (m, val) = if v.contains('=') {
                    (parse_num(m)?, parse_num(val)?)
                } else {
                    (0xFFFF, parse_num(m)?)
                };
                trace = Some((m as u16, val as u16));
            }
            "--tape-log" => tape_log = true,
            f if f.starts_with("--") => return Err(format!("zx run: unknown option {f}")),
            f => files.push(f.to_string()),
        }
    }
    options.auto_tape = !no_auto;
    let _ = model_set;
    let mut s = Session::new(model, options);
    if let Some(p) = &load_state {
        let b = std::fs::read(p).map_err(|e| format!("{p}: {e}"))?;
        s.zx.load_state(&b).map_err(|e| format!("{p}: {e}"))?;
    }
    let mut loaded = Vec::new();
    let mut tape_loaded = false;
    for f in &files {
        let bytes = std::fs::read(f).map_err(|e| format!("{f}: {e}"))?;
        let name = std::path::Path::new(f)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let l = s.zx.load(&bytes, &name).map_err(|e| e.to_string())?;
        if l.kind == spectrum::LoadedKind::Tape {
            tape_loaded = true;
        }
        loaded.push(json!({
            "file": f,
            "name": l.name,
            "kind": format!("{:?}", l.kind).to_lowercase(),
            "model": l.model.map(|m| m.id()),
            "others": l.others,
        }));
    }
    // What was asked for on the command line wins over what a snapshot or a state said.
    let mut o = s.zx.options();
    if let Some(v) = forced.issue2 {
        o.issue2 = v;
    }
    if let Some(v) = forced.late {
        o.late_timings = v;
    }
    if let Some(v) = forced.snow {
        o.snow = v;
    }
    if let Some(v) = forced.ay48 {
        o.ay_on_48k = v;
    }
    s.zx.set_options(o);
    if let Some(j) = joystick {
        s.zx.joystick(j, 0);
    }
    if tape_loaded && !no_load && s.zx.frames() == 0 {
        at.push((0, Action::Load));
        s.play_on_load = no_auto;
    }
    s.at = at;
    s.when = when;
    s.profile = profile.map(|n| (n, std::collections::BTreeMap::new()));
    s.port_trace = trace.map(|(m, v)| (m, v, Vec::new()));
    if wav.is_some() {
        s.audio = Some(Vec::new());
    }
    let start = Instant::now();
    let mut found: Option<u64> = None;
    let mut ok = true;
    if let Some(t) = &until {
        found = s.run_until(t, max_frames);
        ok = found.is_some();
    }
    let extra = frames.unwrap_or(if until.is_some() { 0 } else { 100 });
    s.run_frames(extra);
    let wall = start.elapsed().as_secs_f64();
    if let Some(p) = &png {
        let data = image::png_indexed(
            s.zx.frame(),
            s.zx.frame_width(),
            s.zx.frame_height(),
            &spectrum::PALETTE,
            scale,
        );
        std::fs::write(p, data).map_err(|e| format!("{p}: {e}"))?;
        s.written.push(p.clone());
    }
    if let (Some(p), Some(a)) = (&wav, &s.audio) {
        std::fs::write(p, zx_cli::wav::wav(a, s.zx.sample_rate()))
            .map_err(|e| format!("{p}: {e}"))?;
        s.written.push(p.clone());
    }
    if let Some(p) = &save_snap {
        let fmt = match std::path::Path::new(p)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref()
        {
            Some("sna") => snapshot::Format::Sna,
            Some("szx") => snapshot::Format::Szx,
            _ => snapshot::Format::Z80,
        };
        let data = snapshot::save(&s.zx.snapshot(), fmt).map_err(|e| e.to_string())?;
        std::fs::write(p, data).map_err(|e| format!("{p}: {e}"))?;
        s.written.push(p.clone());
    }
    if let Some(p) = &save_state {
        std::fs::write(p, s.zx.save_state()).map_err(|e| format!("{p}: {e}"))?;
        s.written.push(p.clone());
    }
    let screen = s.text();
    let model = s.zx.model();
    let emulated = s.frame as f64 / model.frame_rate();
    let hot: Vec<Value> = match &s.profile {
        Some((_, counts)) => {
            let total: u64 = counts.values().sum();
            let mut v: Vec<(u16, u64)> = counts.iter().map(|(&pc, &c)| (pc, c)).collect();
            v.sort_by_key(|&(_, c)| std::cmp::Reverse(c));
            v.iter()
                .take(20)
                .map(|&(pc, c)| json!({"pc": pc, "share": c as f64 / total.max(1) as f64, "instruction": s.zx.disassemble(pc).0}))
                .collect()
        }
        None => Vec::new(),
    };
    let ports: Vec<Value> = s
        .port_trace
        .as_ref()
        .map(|(_, _, log)| {
            log.iter()
                .map(|&(f, t, p, v)| json!({"frame": f, "t": t, "port": p, "value": v}))
                .collect()
        })
        .unwrap_or_default();
    let tlog: Vec<Value> = if tape_log {
        s.zx.tape_log()
            .into_iter()
            .map(|(f, t, op)| json!({"frame": f, "t": t, "op": op}))
            .collect()
    } else {
        Vec::new()
    };
    if json_out {
        let mut pk = serde_json::Map::new();
        for &a in &peeks {
            pk.insert(format!("0x{a:04X}"), json!(s.zx.peek(a)));
        }
        let ts = s.zx.tape_state();
        let out = json!({
            "model": model.id(),
            "options": {"issue2": s.zx.options().issue2, "late_timings": s.zx.options().late_timings,
                        "instant_load": s.zx.options().instant_load, "auto_tape": s.zx.options().auto_tape},
            "loaded": loaded,
            "frames": s.frame,
            "seconds_emulated": emulated,
            "until": until.as_ref().map(|t| json!({"text": t, "found_at": found})),
            "text": screen.rows,
            "inverse": screen.inverse_rows(),
            "peek": pk,
            "tape": {"loaded": ts.loaded, "playing": ts.playing, "block": ts.block,
                     "position": ts.position, "length": ts.length},
            "load_typed_at": s.loaded_at,
            "written": s.written,
            "log": s.log,
            "registers": registers_json(&s.zx),
            "profile": hot,
            "port_writes": ports,
            "tape_log": tlog,
            "tape_status": s.zx.tape_status().map(|st| json!({"block": st.block, "playing": st.playing,
                "stopped_by": st.stopped_by.map(|r| format!("{r:?}")), "at_end": st.at_end})),
            "speed": {"wall_seconds": wall, "times_real_time": if wall > 0.0 { emulated / wall } else { 0.0 }},
        });
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        if text {
            println!("+{}+", "-".repeat(32));
            for r in &screen.rows {
                println!("|{r}|");
            }
            println!("+{}+", "-".repeat(32));
        }
        for &a in &peeks {
            println!("peek 0x{a:04X} = {} (0x{:02X})", s.zx.peek(a), s.zx.peek(a));
        }
        if let Some(t) = &until {
            match found {
                Some(f) => eprintln!("'{t}' at frame {f}"),
                None => eprintln!("'{t}' not seen in {max_frames} frames"),
            }
        }
        for l in &s.log {
            eprintln!("{l}");
        }
        for h in &hot {
            println!(
                "{:04X} {:5.1}%  {}",
                h["pc"].as_u64().unwrap(),
                h["share"].as_f64().unwrap() * 100.0,
                h["instruction"].as_str().unwrap()
            );
        }
        for p in &ports {
            println!(
                "frame {} t {} port {:04X} = {:02X}",
                p["frame"],
                p["t"],
                p["port"].as_u64().unwrap(),
                p["value"].as_u64().unwrap()
            );
        }
        for e in &tlog {
            println!(
                "tape: frame {} t {} {}",
                e["frame"],
                e["t"],
                e["op"].as_str().unwrap()
            );
        }
        eprintln!(
            "{}: {} frames ({:.1} s emulated) in {:.2} s, {:.0}x real time",
            model.id(),
            s.frame,
            emulated,
            wall,
            if wall > 0.0 { emulated / wall } else { 0.0 }
        );
    }
    Ok(if ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn registers_json(zx: &Machine) -> Value {
    let r = zx.registers();
    json!({
        "af": r.af, "bc": r.bc, "de": r.de, "hl": r.hl, "af_": r.af_, "bc_": r.bc_, "de_": r.de_, "hl_": r.hl_,
        "ix": r.ix, "iy": r.iy, "sp": r.sp, "pc": r.pc, "i": r.i, "r": r.r, "im": r.im,
        "iff1": r.iff1, "iff2": r.iff2, "halted": r.halted, "t": r.t,
    })
}

/// A file's bytes, out of a zip if it is one (the first entry of `kinds`).
fn read_file(path: &str, want: impl Fn(unzip::Kind) -> bool) -> Result<(Vec<u8>, String), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    if unzip::is_zip(&bytes) {
        let files = unzip::spectrum_files(&bytes).map_err(|e| format!("{path}: {e}"))?;
        let f = files
            .into_iter()
            .find(|f| want(f.kind))
            .ok_or_else(|| format!("{path}: nothing of the kind in the zip"))?;
        return Ok((f.data, f.name));
    }
    Ok((bytes, path.to_string()))
}

fn cmd_tape(mut args: Args) -> Result<ExitCode, String> {
    let (mut file, mut json_out) = (None, false);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!(
                    "zx tape FILE [--json]\n\nThe blocks of a tape (TAP, TZX, CSW, PZX, or a zip holding one): each block's kind,\nwhat it is (in the ROM's words), its length in bytes and in seconds of tape."
                );
                return Ok(ExitCode::SUCCESS);
            }
            "--json" => json_out = true,
            f => file = Some(f.to_string()),
        }
    }
    let file = file.ok_or("zx tape FILE")?;
    let (bytes, name) = read_file(&file, |k| k.is_tape())?;
    let mut zx = Machine::new(Model::Spectrum48);
    zx.load(&bytes, &name).map_err(|e| e.to_string())?;
    let blocks = zx.tape_blocks();
    let ts = zx.tape_state();
    if json_out {
        let b: Vec<Value> = blocks
            .iter()
            .map(|b| json!({"kind": b.kind, "label": b.label, "bytes": b.bytes, "seconds": b.seconds}))
            .collect();
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({"name": name, "blocks": b, "seconds": ts.length}))
                .unwrap()
        );
    } else {
        for (i, b) in blocks.iter().enumerate() {
            println!("{i:3} {:7} {:8.3} s  {}", b.kind, b.seconds, b.label);
        }
        println!("{} blocks, {:.3} s", blocks.len(), ts.length);
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_snap(mut args: Args) -> Result<ExitCode, String> {
    let (mut file, mut json_out) = (None, false);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!(
                    "zx snap FILE [--json]\n\nWhat a snapshot (.z80, .sna, .szx, .slt, or a zip holding one) holds: its model, registers,\nT-state, ports and paging."
                );
                return Ok(ExitCode::SUCCESS);
            }
            "--json" => json_out = true,
            f => file = Some(f.to_string()),
        }
    }
    let file = file.ok_or("zx snap FILE")?;
    let (bytes, _) = read_file(&file, |k| k.is_snapshot())?;
    let s = snapshot::load(&bytes).map_err(|e| e.to_string())?;
    let r = &s.regs;
    let out = json!({
        "format": snapshot::detect(&bytes).map(|f| f.extension()),
        "model": Model::from_snapshot(s.model).id(),
        "pc": r.pc, "sp": r.sp, "af": r.af, "bc": r.bc, "de": r.de, "hl": r.hl, "ix": r.ix, "iy": r.iy,
        "i": r.i, "r": r.r, "im": r.im, "iff1": r.iff1, "iff2": r.iff2, "halted": r.halted,
        "tstates": s.tstates, "border": s.border(), "port_7ffd": s.port_7ffd, "port_1ffd": s.port_1ffd,
        "ay": s.ay.is_some(), "issue2": s.issue2, "late_timings": s.late_timings,
        "joystick": s.joystick.map(|j| format!("{j:?}")),
        "slt_levels": s.slt.as_ref().map(|l| l.levels.len()),
    });
    if json_out {
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        println!(
            "{} snapshot of a {}: PC {:04X} SP {:04X} AF {:04X} IM {} {}T, border {}, 7FFD {:02X}",
            out["format"].as_str().unwrap_or("?"),
            out["model"].as_str().unwrap(),
            r.pc,
            r.sp,
            r.af,
            r.im,
            s.tstates,
            s.border(),
            s.port_7ffd
        );
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_disasm(mut args: Args) -> Result<ExitCode, String> {
    let (mut file, mut model, mut org, mut from, mut count, mut json_out) =
        (None, Model::Spectrum48, 0u16, None, 32usize, false);
    let mut opts = Options::default();
    while let Some(a) = args.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!(
                    "zx disasm [FILE] [--model M] [--org ADDR] [--from ADDR] [--count N] [--json]\n\nDisassembles memory as the CPU sees it: the model's ROM (no FILE), a snapshot's memory, or a\nbinary FILE loaded at --org (default 0). From --from (default --org, or a snapshot's PC), --count\ninstructions (default 32)."
                );
                return Ok(ExitCode::SUCCESS);
            }
            "--model" => model = parse_model(&args.value(&a)?, &mut opts)?,
            "--org" => org = parse_num(&args.value(&a)?)? as u16,
            "--from" => from = Some(parse_num(&args.value(&a)?)? as u16),
            "--count" => count = parse_num(&args.value(&a)?)? as usize,
            "--json" => json_out = true,
            f => file = Some(f.to_string()),
        }
    }
    let mut zx = Machine::new(model);
    let mut mem: Vec<u8> = (0..=0xFFFFu16).map(|a| zx.peek(a)).collect();
    let mut start = from.unwrap_or(org);
    if let Some(f) = &file {
        let bytes = std::fs::read(f).map_err(|e| format!("{f}: {e}"))?;
        if let Ok(snap) = snapshot::load(&bytes) {
            zx.restore(&snap);
            mem = (0..=0xFFFFu16).map(|a| zx.peek(a)).collect();
            start = from.unwrap_or(zx.registers().pc);
        } else {
            for (i, &b) in bytes.iter().enumerate() {
                mem[(org as usize + i) & 0xFFFF] = b;
            }
        }
    }
    let mut at = start;
    let mut lines = Vec::new();
    for _ in 0..count {
        let i = z80::disasm::disassemble(|a| mem[a as usize], at);
        let bytes: Vec<String> = (0..i.len)
            .map(|k| format!("{:02X}", mem[at.wrapping_add(k as u16) as usize]))
            .collect();
        lines.push((at, bytes.join(" "), i.text.clone(), i.undocumented));
        at = at.wrapping_add(i.len as u16);
    }
    if json_out {
        let v: Vec<Value> = lines
            .iter()
            .map(|(a, b, t, u)| json!({"addr": a, "bytes": b, "text": t, "undocumented": u}))
            .collect();
        println!("{}", serde_json::to_string_pretty(&v).unwrap());
    } else {
        for (a, b, t, u) in lines {
            println!(
                "{a:04X}  {b:<12} {t}{}",
                if u { "   ; undocumented" } else { "" }
            );
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_screen(mut args: Args) -> Result<ExitCode, String> {
    let (mut file, mut png, mut scale, mut text, mut border, mut json_out) =
        (None, None, 1usize, false, 7u8, false);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!(
                    "zx screen FILE [--png PATH] [--scale N] [--border C] [--text] [--json]\n\nA screen dump (.scr, 6,912 bytes) drawn as the machine draws it, in a frame of 352 x 296 with the paper at\n(48, 48) and the border colour C (default 7), as a PNG; or read as text. FILE can also be a picture (PNG or\nGIF: a reference capture), read as text against the ROM font."
                );
                return Ok(ExitCode::SUCCESS);
            }
            "--png" => png = Some(args.value(&a)?),
            "--scale" => scale = parse_num(&args.value(&a)?)? as usize,
            "--border" => border = parse_num(&args.value(&a)?)? as u8 & 7,
            "--text" => text = true,
            "--json" => json_out = true,
            f => file = Some(f.to_string()),
        }
    }
    let file = file.ok_or("zx screen FILE.scr")?;
    let raw = std::fs::read(&file).map_err(|e| format!("{file}: {e}"))?;
    if raw.starts_with(b"\x89PNG") || raw.starts_with(b"GIF8") {
        // A picture (a reference capture): read as text where it is the frame's size, or 352 x 240 (z80test's
        // window) or 256 x 192 (the paper alone).
        let rgb = image::read_image(&raw).map_err(|e| format!("{file}: {e}"))?;
        let nums = rgb.colour_numbers();
        let mut frame = vec![7u8; 352 * 296];
        let (ox, oy) = match (rgb.width, rgb.height) {
            (352, 240) => (0, 24),
            (256, 192) => (48, 48),
            _ => (0, 0),
        };
        for y in 0..rgb.height.min(296 - oy) {
            for x in 0..rgb.width.min(352 - ox) {
                frame[(y + oy) * 352 + x + ox] = nums[y * rgb.width + x];
            }
        }
        let t = spectrum::screen::read_frame(&frame, |_, _| 255);
        if json_out {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({"text": t.rows, "inverse": t.inverse_rows()}))
                    .unwrap()
            );
        } else {
            for r in &t.rows {
                println!("{r}");
            }
        }
        return Ok(ExitCode::SUCCESS);
    }
    let (bytes, name) = read_file(&file, |k| k == unzip::Kind::Scr)?;
    let mut zx = Machine::new(Model::Spectrum48);
    zx.load(
        &bytes,
        if name.ends_with(".scr") {
            &name
        } else {
            "screen.scr"
        },
    )
    .map_err(|e| e.to_string())?;
    zx.set_border_now(border);
    zx.redraw();
    if let Some(p) = &png {
        std::fs::write(
            p,
            image::png_indexed(
                zx.frame(),
                zx.frame_width(),
                zx.frame_height(),
                &spectrum::PALETTE,
                scale,
            ),
        )
        .map_err(|e| format!("{p}: {e}"))?;
    }
    let t = zx.screen_text();
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(
                &json!({"text": t.rows, "inverse": t.inverse_rows(), "png": png})
            )
            .unwrap()
        );
    } else if text || png.is_none() {
        for r in &t.rows {
            println!("{r}");
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn cmd_bench(mut args: Args) -> Result<ExitCode, String> {
    let (mut models, mut frames, mut json_out, mut file) =
        (Model::ALL.to_vec(), 3000u64, false, None);
    let mut instant = false;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!(
                    "zx bench [--model M] [--frames N] [FILE] [--instant] [--json]\n\nHow fast each model runs here, natively: N frames (default 3000) from power-on (the ROM's boot and\nits idle loop), or of FILE loading (LOAD \"\" typed). Frames a second and times real time. A measure of\nthis machine as well as of the code: never a test."
                );
                return Ok(ExitCode::SUCCESS);
            }
            "--model" => {
                let mut o = Options::default();
                models = vec![parse_model(&args.value(&a)?, &mut o)?];
            }
            "--frames" => frames = parse_num(&args.value(&a)?)?,
            "--instant" => instant = true,
            "--json" => json_out = true,
            f => file = Some(f.to_string()),
        }
    }
    let mut out = Vec::new();
    for m in models {
        let options = Options {
            instant_load: instant,
            ..Options::default()
        };
        let mut s = Session::new(m, options);
        if let Some(f) = &file {
            let bytes = std::fs::read(f).map_err(|e| format!("{f}: {e}"))?;
            s.zx.load(&bytes, f).map_err(|e| e.to_string())?;
            s.at.push((0, Action::Load));
        }
        let start = Instant::now();
        s.run_frames(frames);
        let wall = start.elapsed().as_secs_f64();
        let fps = frames as f64 / wall;
        let x = fps / m.frame_rate();
        out.push(json!({"model": m.id(), "frames": frames, "seconds": wall, "fps": fps, "times_real_time": x}));
        if !json_out {
            println!(
                "{:9} {frames} frames in {wall:.2} s: {fps:.0} frames/s, {x:.0}x real time",
                m.id()
            );
        }
    }
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(&Value::Array(out)).unwrap()
        );
    }
    Ok(ExitCode::SUCCESS)
}

fn load_picture(path: &str) -> Result<(Vec<u8>, usize, usize), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    if bytes.len() == 6912 || path.ends_with(".scr") {
        let mut zx = Machine::new(Model::Spectrum48);
        zx.load(&bytes, "screen.scr").map_err(|e| e.to_string())?;
        zx.redraw();
        let f = zx.frame();
        let mut paper = Vec::with_capacity(256 * 192);
        for y in 0..192 {
            let at = (48 + y) * 352 + 48;
            paper.extend_from_slice(&f[at..at + 256]);
        }
        return Ok((paper, 256, 192));
    }
    let rgb = image::read_image(&bytes).map_err(|e| format!("{path}: {e}"))?;
    Ok((rgb.colour_numbers(), rgb.width, rgb.height))
}

fn cmd_compare(mut args: Args) -> Result<ExitCode, String> {
    let (mut files, mut offset, mut json_out, mut diff) = (Vec::new(), None, false, None);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--help" | "-h" => {
                println!(
                    "zx compare A B [--offset X,Y] [--diff PATH] [--json]\n\nCompares picture B (PNG, GIF or .scr) with A by Spectrum colour number (each pixel the nearest\nof the colours in its own palette, bright black as black), B placed at X,Y in A: by default 0,0\nfor pictures of one size, 0,24 for a 352 x 240 reference (z80test's), 48,48 for 256 x 192 (the\npaper alone). --diff writes A, B and their differences side by side around where they differ, enlarged.\nExits 0 when they are the same, 1 when not."
                );
                return Ok(ExitCode::SUCCESS);
            }
            "--offset" => {
                let v = args.value(&a)?;
                let (x, y) = v.split_once(',').ok_or("--offset X,Y")?;
                offset = Some((parse_num(x)? as usize, parse_num(y)? as usize));
            }
            "--json" => json_out = true,
            "--diff" => diff = Some(args.value(&a)?),
            f => files.push(f.to_string()),
        }
    }
    if files.len() != 2 {
        return Err("zx compare A B".into());
    }
    let (a, aw, ah) = load_picture(&files[0])?;
    let (b, bw, bh) = load_picture(&files[1])?;
    let (ox, oy) = offset.unwrap_or(match (aw, ah, bw, bh) {
        (352, 296, 352, 240) => (0, 24),
        (352, 296, 256, 192) => (48, 48),
        _ => (0, 0),
    });
    let d = image::compare(&a, aw, ox, oy, &b, bw, bh);
    if let Some(path) = &diff {
        // A, B and where they differ (white), side by side: the differences' surroundings, enlarged.
        let (x0, y0, x1, y1) =
            d.bounds
                .unwrap_or((0, 0, bw.saturating_sub(1), bh.saturating_sub(1)));
        let m = 16;
        let (cx0, cy0) = (x0.saturating_sub(m), y0.saturating_sub(m));
        let (cx1, cy1) = ((x1 + m).min(bw - 1), (y1 + m).min(bh - 1));
        let (w, h) = (cx1 - cx0 + 1, cy1 - cy0 + 1);
        let scale = (512 / w.max(h)).clamp(1, 8);
        let mut out = vec![0u8; (3 * w + 2) * h];
        let stride = 3 * w + 2;
        for y in 0..h {
            for x in 0..w {
                let (bx, by) = (cx0 + x, cy0 + y);
                let pa = a.get((by + oy) * aw + bx + ox).copied().unwrap_or(0);
                let pb = b[by * bw + bx];
                out[y * stride + x] = pa;
                out[y * stride + w + 1 + x] = pb;
                let norm = |c: u8| if c == 8 { 0 } else { c };
                out[y * stride + 2 * w + 2 + x] = if norm(pa) != norm(pb) { 15 } else { 8 };
            }
            out[y * stride + w] = 2;
            out[y * stride + 2 * w + 1] = 2;
        }
        std::fs::write(
            path,
            image::png_indexed(&out, stride, h, &spectrum::PALETTE, scale),
        )
        .map_err(|e| format!("{path}: {e}"))?;
    }
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "a": files[0], "b": files[1], "a_size": [aw, ah], "b_size": [bw, bh], "offset": [ox, oy],
                "compared": d.compared, "differing": d.differing, "same": d.differing == 0 && d.compared > 0,
                "bounds": d.bounds.map(|(x0, y0, x1, y1)| [x0, y0, x1, y1]),
                "examples": d.examples.iter().map(|(x, y, p, q)| json!({"x": x, "y": y, "a": p, "b": q})).collect::<Vec<_>>(),
            }))
            .unwrap()
        );
    } else {
        println!(
            "{} of {} pixels differ{}",
            d.differing,
            d.compared,
            match d.bounds {
                Some((x0, y0, x1, y1)) => format!(", within ({x0},{y0})-({x1},{y1}) of B"),
                None => String::new(),
            }
        );
    }
    Ok(if d.differing == 0 && d.compared > 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    })
}

fn main() -> ExitCode {
    let all: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = all.first().cloned() else {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    };
    let args = Args {
        items: all[1..].to_vec(),
        at: 0,
    };
    let r = match cmd.as_str() {
        "run" => cmd_run(args),
        "tape" => cmd_tape(args),
        "snap" => cmd_snap(args),
        "disasm" => cmd_disasm(args),
        "screen" => cmd_screen(args),
        "bench" => cmd_bench(args),
        "compare" => cmd_compare(args),
        "--help" | "-h" | "help" => {
            println!("{HELP}");
            Ok(ExitCode::SUCCESS)
        }
        other => Err(format!("zx: no command '{other}' (zx --help)")),
    };
    match r {
        Ok(c) => c,
        Err(e) => {
            eprintln!("zx: {e}");
            ExitCode::from(2)
        }
    }
}
