# ROMs

The machines' own firmware, as dumped from the chips, byte for byte. They are compiled into the emulator
(`crates/spectrum` includes them), so that it starts as the machine did: the copyright message, then BASIC.

| File | Machine | SHA-1 |
|------|---------|-------|
| `48.rom` | ZX Spectrum 16K/48K | `5ea7c2b824672e914525d1d5c419d71b84a426a2` |
| `128-0.rom`, `128-1.rom` | ZX Spectrum 128 (the 128 editor and menu; 48 BASIC); also the Pentagon 128 | `4f4b11ec…`, `80080644…` |
| `plus2-0.rom`, `plus2-1.rom` | ZX Spectrum +2 (grey) | `72703f9a…`, `de8b0d2d…` |
| `plus3-0.rom` … `plus3-3.rom` | ZX Spectrum +2A / +3 | |

They were taken from the Debian/Ubuntu `spectrum-roms` package (20081224), which took them from
shadowmagic.org.uk.

Copyright in them is held as follows: `48.rom` © 1982 Sinclair Research Ltd; `128-0.rom` © 1986 and `128-1.rom`
© 1982 Sinclair Research Ltd; the +2 and +3 ROMs © 1982, 1986, 1987 Amstrad plc. Sinclair's rights are now
Amstrad's (since 2007 Sky's).

**Amstrad have kindly given their permission for the redistribution of their copyrighted material but retain
that copyright.** In Cliff Lawson's words for Amstrad (comp.sys.sinclair, 1999): "Amstrad are happy for emulator
writers to include images of our copyrighted code as long as the (c)opyright messages are not altered", and no
one may charge for them. The images here are unaltered, and nothing here is sold.
