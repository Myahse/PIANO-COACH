import { clampNote } from "./notes";
import type { TimedNote } from "./timed";

type Cursor = { n: number };

function readVarLen(view: DataView, cur: Cursor): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const byte = view.getUint8(cur.n);
    cur.n += 1;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return value;
}

function decodeString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
}

export function parseMidi(buffer: ArrayBuffer): { title: string; notes: TimedNote[] } {
  const view = new DataView(buffer);
  if (view.byteLength < 14 || view.getUint32(0) !== 0x4d546864) {
    throw new Error("That file is not a MIDI file. Try a .mid export.");
  }

  const headerLength = view.getUint32(4);
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) {
    throw new Error("This MIDI uses SMPTE timing, which is not supported yet.");
  }
  if (format > 1) {
    throw new Error("This MIDI format is not supported yet. Export as type 0 or 1.");
  }

  const ticksPerBeat = division;
  const cur: Cursor = { n: 8 + headerLength };
  const notes: TimedNote[] = [];
  let title = "Imported MIDI";
  let tempo = 500000;

  for (let track = 0; track < trackCount && cur.n + 8 <= view.byteLength; track++) {
    if (view.getUint32(cur.n) !== 0x4d54726b) break;
    const length = view.getUint32(cur.n + 4);
    cur.n += 8;
    const end = cur.n + length;
    let tick = 0;
    let running = 0;
    const open = new Map<number, { start: number; velocity: number }>();

    while (cur.n < end) {
      tick += readVarLen(view, cur);
      let status = view.getUint8(cur.n);
      if (status < 0x80) {
        status = running;
      } else {
        cur.n += 1;
        running = status;
      }

      const command = status & 0xf0;
      if (command === 0x80 || command === 0x90) {
        const note = clampNote(view.getUint8(cur.n));
        const velocity = view.getUint8(cur.n + 1);
        cur.n += 2;
        const seconds = (tick * tempo) / (ticksPerBeat * 1_000_000);
        if (command === 0x80 || velocity === 0) {
          const hit = open.get(note);
          if (hit !== undefined) {
            notes.push({
              note,
              start: hit.start,
              duration: Math.max(0.08, seconds - hit.start),
              velocity: hit.velocity,
            });
            open.delete(note);
          }
        } else {
          open.set(note, { start: seconds, velocity });
        }
      } else if (command === 0xa0 || command === 0xb0 || command === 0xe0) {
        cur.n += 2;
      } else if (command === 0xc0 || command === 0xd0) {
        cur.n += 1;
      } else if (status === 0xff) {
        const type = view.getUint8(cur.n);
        cur.n += 1;
        const size = readVarLen(view, cur);
        const data = new Uint8Array(view.buffer, view.byteOffset + cur.n, size);
        cur.n += size;
        if (type === 0x51 && size >= 3) {
          tempo = (data[0]! << 16) | (data[1]! << 8) | data[2]!;
        }
        if ((type === 0x03 || type === 0x01) && size > 0) {
          const name = decodeString(data);
          if (name) title = name;
        }
      } else if (status === 0xf0 || status === 0xf7) {
        cur.n += readVarLen(view, cur);
      } else {
        break;
      }
    }
    cur.n = end;
    for (const [note, hit] of open) {
      notes.push({ note, start: hit.start, duration: 0.4, velocity: hit.velocity });
    }
  }

  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  if (notes.length === 0) throw new Error("No notes were found in that MIDI file.");
  return { title, notes };
}

export function writeMidi(notes: TimedNote[], title = "Piano Coach"): ArrayBuffer {
  const ticksPerBeat = 480;
  const tempo = 500000;
  const events: { tick: number; bytes: number[] }[] = [];
  const name = new TextEncoder().encode(title.slice(0, 32));
  events.push({ tick: 0, bytes: [0xff, 0x03, name.length, ...name] });
  events.push({ tick: 0, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] });

  for (const note of notes) {
    const start = Math.max(0, Math.round((note.start * 1_000_000 * ticksPerBeat) / tempo));
    const end = Math.max(start + 8, Math.round(((note.start + note.duration) * 1_000_000 * ticksPerBeat) / tempo));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity ?? 100)));
    events.push({ tick: start, bytes: [0x90, note.note, velocity] });
    events.push({ tick: end, bytes: [0x80, note.note, 0x40] });
  }
  events.sort((a, b) => a.tick - b.tick);
  events.push({ tick: events.at(-1)?.tick ?? 0, bytes: [0xff, 0x2f, 0x00] });

  const track: number[] = [];
  let last = 0;
  for (const event of events) {
    writeVarLen(track, event.tick - last);
    track.push(...event.bytes);
    last = event.tick;
  }

  const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1,
    (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff,
  ];
  const body = [
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >> 24) & 0xff, (track.length >> 16) & 0xff,
    (track.length >> 8) & 0xff, track.length & 0xff,
    ...track,
  ];
  return new Uint8Array([...header, ...body]).buffer;
}

function writeVarLen(out: number[], value: number): void {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  out.push(...bytes);
}
