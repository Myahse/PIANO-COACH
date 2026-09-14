import { unzipSync } from "fflate";
import { clampNote } from "./notes";
import type { TimedNote } from "./timed";

const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function isMusicXmlFile(name: string, type: string): boolean {
  if (/\.(musicxml|mxl)$/i.test(name)) return true;
  if (/\.xml$/i.test(name)) return true;
  return type.includes("musicxml") || type.includes("/vnd.recordare");
}

export async function loadMusicXmlText(buffer: ArrayBuffer, filename: string): Promise<string> {
  const bytes = new Uint8Array(buffer);
  if (/\.mxl$/i.test(filename) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return extractMxl(bytes);
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.includes("<score-partwise") && !text.includes("<score-timewise")) {
    throw new Error("That XML file is not MusicXML. Export .musicxml or .mxl from MuseScore.");
  }
  return text;
}

function extractMxl(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const rootPath = findMxlRoot(files);
  const xmlBytes = files[rootPath];
  if (!xmlBytes) throw new Error("Could not read the MusicXML inside that .mxl file.");
  return new TextDecoder().decode(xmlBytes);
}

function findMxlRoot(files: Record<string, Uint8Array>): string {
  const container = files["META-INF/container.xml"];
  if (container) {
    const xml = new TextDecoder().decode(container);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const href = doc.querySelector("rootfile")?.getAttribute("full-path");
    if (href && files[href]) return href;
  }
  const xmlName = Object.keys(files).find((name) => name.endsWith(".xml") || name.endsWith(".musicxml"));
  if (xmlName) return xmlName;
  throw new Error("No MusicXML document found in that .mxl file.");
}

export function parseMusicXml(text: string): { title: string; notes: TimedNote[] } {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid MusicXML.");
  if (doc.querySelector("score-timewise")) {
    throw new Error("score-timewise MusicXML is not supported yet. Re-export as score-partwise from MuseScore.");
  }
  const root = doc.querySelector("score-partwise");
  if (!root) throw new Error("That file is not score-partwise MusicXML.");

  const title =
    doc.querySelector("work work-title")?.textContent?.trim() ||
    doc.querySelector("movement-title")?.textContent?.trim() ||
    "Imported score";

  const notes: TimedNote[] = [];
  for (const part of root.querySelectorAll(":scope > part")) {
    notes.push(...parsePart(part));
  }
  notes.sort((a, b) => a.start - b.start || a.note - b.note);
  if (notes.length < 1) throw new Error("No notes were found in that MusicXML file.");
  return { title, notes };
}

function parsePart(part: Element): TimedNote[] {
  const notes: TimedNote[] = [];
  let divisions = 480;
  let tempo = 120;
  let measureOffset = 0;

  for (const measure of part.querySelectorAll(":scope > measure")) {
    let cursor = 0;
    for (const child of measure.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === "attributes") {
        const div = child.querySelector("divisions");
        if (div?.textContent) divisions = Math.max(1, Number(div.textContent));
        continue;
      }
      if (tag === "direction") {
        const sound = child.querySelector("sound[tempo]");
        if (sound) {
          const next = Number(sound.getAttribute("tempo"));
          if (Number.isFinite(next) && next > 20) tempo = next;
        }
        const metronome = child.querySelector("metronome");
        if (metronome?.querySelector("beat-unit")?.textContent === "quarter") {
          const next = Number(metronome.querySelector("per-minute")?.textContent);
          if (Number.isFinite(next) && next > 20) tempo = next;
        }
        continue;
      }
      if (tag === "forward") {
        cursor += readDuration(child, divisions);
        continue;
      }
      if (tag === "backup") {
        cursor -= readDuration(child, divisions);
        continue;
      }
      if (tag !== "note") continue;

      const durationDiv = readDuration(child, divisions);
      const isRest = child.querySelector("rest") !== null;
      const isGrace = child.querySelector("grace") !== null;
      const isChord = child.querySelector("chord") !== null;
      if (isRest || isGrace || durationDiv <= 0) {
        if (!isChord && !isGrace) cursor += durationDiv;
        continue;
      }

      const midi = readPitch(child);
      if (midi === null) {
        if (!isChord) cursor += durationDiv;
        continue;
      }

      const start = measureOffset + divToSec(cursor, divisions, tempo);
      const duration = divToSec(durationDiv, divisions, tempo);
      notes.push({
        note: clampNote(midi),
        start,
        duration: Math.max(0.05, duration),
        velocity: readVelocity(child),
      });
      if (!isChord) cursor += durationDiv;
    }
    measureOffset += divToSec(Math.max(cursor, divisions), divisions, tempo);
  }
  return notes;
}

function readDuration(el: Element, fallbackDivisions: number): number {
  const raw = Number(el.querySelector(":scope > duration")?.textContent);
  return Number.isFinite(raw) && raw > 0 ? raw : fallbackDivisions / 4;
}

function readPitch(note: Element): number | null {
  const pitch = note.querySelector("pitch");
  if (!pitch) return null;
  const step = pitch.querySelector("step")?.textContent?.trim();
  const octave = Number(pitch.querySelector("octave")?.textContent);
  if (!step || !Number.isFinite(octave)) return null;
  const alter = Number(pitch.querySelector("alter")?.textContent || "0");
  const semitone = STEP_SEMITONE[step];
  if (semitone === undefined) return null;
  return (octave + 1) * 12 + semitone + alter;
}

function readVelocity(_note: Element): number {
  return 80;
}

function divToSec(divisions: number, divisionsPerQuarter: number, tempo: number): number {
  return (divisions / divisionsPerQuarter) * (60 / tempo);
}
