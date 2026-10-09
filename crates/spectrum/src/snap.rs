//! The machine as a `snapshot::Snapshot` (for .z80, .sna and .szx files), and back.

use snapshot::{Ay, AyInterface, Registers, Snapshot};

use crate::input::Joystick;
use crate::machine::Machine;
use crate::model::Model;

impl Machine {
    /// The machine now, as a snapshot. Taken between a DD/FD prefix and its opcode (a frame can end there),
    /// PC is put back on the prefix, which then runs again: no file format can say a prefix is pending.
    pub fn snapshot(&self) -> Snapshot {
        let model = self.model();
        let r = &self.cpu.regs;
        let mut pc = r.pc;
        let mut rr = r.r;
        if r.prefix != 0 {
            pc = pc.wrapping_sub(1);
            rr = (rr & 0x80) | (rr.wrapping_sub(1) & 0x7F);
        }
        if r.halted {
            // The snapshot's convention (Fuse's): PC at the HALT itself; this CPU has moved past it.
            pc = pc.wrapping_sub(1);
        }
        let mut s = Snapshot::new(model.to_snapshot());
        s.regs = Registers {
            af: r.af(),
            bc: r.bc(),
            de: r.de(),
            hl: r.hl(),
            af_alt: r.af_,
            bc_alt: r.bc_,
            de_alt: r.de_,
            hl_alt: r.hl_,
            ix: r.ix,
            iy: r.iy,
            sp: r.sp,
            pc,
            i: r.i,
            r: rr,
            iff1: r.iff1,
            iff2: r.iff2,
            im: r.im,
            memptr: Some(r.memptr),
            halted: r.halted,
            interrupts_suppressed: r.int_blocked,
            flags_set: r.q != 0 && r.q == r.f,
        };
        s.tstates = self.t.min(model.frame_tstates() - 1);
        s.port_fe = self.hw.port_fe & 0x1F;
        for &b in model.banks() {
            s.ram[b]
                .as_mut()
                .expect("the model's banks")
                .copy_from_slice(self.hw.mem.bank(b));
        }
        if model.is_128k() {
            s.port_7ffd = self.hw.mem.port_7ffd | if self.hw.mem.locked { 0x20 } else { 0 };
        }
        if model.is_plus3() {
            s.port_1ffd = self.hw.mem.port_1ffd;
        }
        if let Some(chip) = &self.hw.ay {
            s.ay = Some(Ay {
                selected: chip.address(),
                registers: chip.registers(),
                interface: if model.has_ay() {
                    AyInterface::BuiltIn
                } else {
                    AyInterface::Melodik
                },
            });
        }
        s.issue2 = model.has_issue() && self.hw.options.issue2;
        s.late_timings = model.has_late_timings() && self.hw.options.late_timings;
        s.joystick = match self.hw.input.joystick {
            Joystick::None => None,
            Joystick::Kempston => Some(snapshot::Joystick::Kempston),
            Joystick::Sinclair1 => Some(snapshot::Joystick::Sinclair1),
            Joystick::Sinclair2 => Some(snapshot::Joystick::Sinclair2),
            Joystick::Cursor => Some(snapshot::Joystick::Cursor),
        };
        s.slt = self.slt.clone();
        s
    }

    /// Puts the machine in a snapshot's state: switched on afresh as the snapshot's model (the tape stays in
    /// the deck), with its RAM, registers, ports, AY and T-state.
    pub fn restore(&mut self, s: &Snapshot) {
        let model = Model::from_snapshot(s.model);
        let mut options = self.options();
        options.issue2 = s.issue2;
        options.late_timings = s.late_timings;
        options.ay_on_48k = !model.has_ay() && s.ay.is_some();
        self.set_options(options);
        self.power_on(model);
        let hw = &mut self.hw;
        for &b in model.banks() {
            if let Some(bank) = &s.ram[b] {
                hw.mem.bank_mut(b).copy_from_slice(&bank[..]);
            }
        }
        if let Some(rom) = &s.custom_rom {
            let roms = model.roms().len();
            if rom.len() == roms * 0x4000 {
                let base = crate::memory::ROM_BASE;
                hw.mem.mem[base..base + rom.len()].copy_from_slice(rom);
            }
        }
        if model.is_128k() {
            hw.mem.port_1ffd = if model.is_plus3() { s.port_1ffd } else { 0 };
            hw.mem.locked = false;
            hw.mem.write_7ffd(s.port_7ffd);
        }
        hw.mem.update();
        let r = &mut self.cpu.regs;
        r.set_af(s.regs.af);
        r.set_bc(s.regs.bc);
        r.set_de(s.regs.de);
        r.set_hl(s.regs.hl);
        r.af_ = s.regs.af_alt;
        r.bc_ = s.regs.bc_alt;
        r.de_ = s.regs.de_alt;
        r.hl_ = s.regs.hl_alt;
        r.ix = s.regs.ix;
        r.iy = s.regs.iy;
        r.sp = s.regs.sp;
        r.i = s.regs.i;
        r.r = s.regs.r;
        r.iff1 = s.regs.iff1;
        r.iff2 = s.regs.iff2;
        r.im = s.regs.im.min(2);
        r.memptr = s.regs.memptr.unwrap_or(0);
        r.halted = s.regs.halted;
        r.pc = if s.regs.halted {
            s.regs.pc.wrapping_add(1)
        } else {
            s.regs.pc
        };
        r.int_blocked = s.regs.interrupts_suppressed && !s.regs.halted;
        r.prefix = 0;
        r.ld_a_ir = false;
        r.q = if s.regs.flags_set { r.f } else { 0 };
        if let (Some(chip), Some(a)) = (&mut self.hw.ay, &s.ay) {
            for (i, &v) in a.registers.iter().enumerate() {
                chip.set_register(i as u8, v);
            }
            chip.select(a.selected);
        }
        if let Some(j) = s.joystick {
            let kind = match j {
                snapshot::Joystick::Kempston => Joystick::Kempston,
                snapshot::Joystick::Sinclair1 => Joystick::Sinclair1,
                snapshot::Joystick::Sinclair2 => Joystick::Sinclair2,
                snapshot::Joystick::Cursor => Joystick::Cursor,
                snapshot::Joystick::Fuller => Joystick::None,
            };
            let bits = self.hw.input.joy_bits;
            self.hw.input.set_joystick(kind, bits);
        }
        self.slt = s.slt.clone().filter(|slt| !slt.levels.is_empty());
        let t = s.tstates.min(self.hw.timing.frame - 1);
        self.t = t;
        let fe = s.port_fe;
        self.hw.port_fe = fe;
        self.hw.sound.beeper_out(t, fe);
        self.hw.sound.buffer.clear();
        // The picture: all of it from the snapshot's screen, then the part of this frame not yet drawn.
        self.hw.video.border = fe & 7;
        self.hw.video.set_position(0, 0);
        self.hw.render_to(u32::MAX);
        self.hw.video.set_position(0, 0);
        self.hw.render_to(t);
        if let Some(tape) = &s.tape
            && let Ok(parsed) = tape::Tape::parse(&tape.data)
        {
            self.insert_tape(
                parsed,
                crate::deck::hash(&tape.data),
                format!("snapshot.{}", tape.extension),
            );
            self.tape_seek(tape.current_block as usize);
        }
        self.update_hooks();
    }
}
