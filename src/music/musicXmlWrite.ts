import type { TimedNote } from "./timed";

const STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"] as const;
const ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0] as const;

export function writeMusicXml(notes: TimedNote[], title = "Piano Coach"): string {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.note - b.note);
  const tempo = 120;
  const divisions = 480;
  const toDiv = (sec: number) => Math.max(1, Math.round((sec * tempo * divisions) / 60));

  let cursor = 0;
  let body = "";

  for (const note of sorted) {
    const at = toDiv(note.start);
    const gap = at - cursor;
    if (gap > 0) {
      body += `        <forward><duration>${gap}</duration></forward>\n`;
      cursor = at;
    }
    const dur = toDiv(note.duration);
    const { step, alter, octave } = midiToPitch(note.note);
    body += `        <note>
          <pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>
          <duration>${dur}</duration>
          <type>${noteType(dur, divisions)}</type>
        </note>\n`;
    cursor += dur;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${escapeXml(title)}</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>
${body}    </measure>
  </part>
</score-partwise>`;
}

function noteType(div: number, divisions: number): string {
  if (div >= divisions * 2) return "half";
  if (div >= divisions) return "quarter";
  if (div >= divisions / 2) return "eighth";
  return "16th";
}

function midiToPitch(midi: number): { step: string; alter: number; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  return { step: STEPS[pc] ?? "C", alter: ALTERS[pc] ?? 0, octave: Math.floor(midi / 12) - 1 };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
