import { isBlackKey, prettyName } from "../music/notes";

export type Clef = "treble" | "bass";

export type StaffNote = {
  midi: number;
  state?: "idle" | "now" | "done";
};

const LETTER_STEPS = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

function diatonicFromC0(midi: number): number {
  const oct = Math.floor(midi / 12);
  return oct * 7 + (LETTER_STEPS[midi % 12] ?? 0);
}

function staffY(midi: number, clef: Clef, lineGap: number, originY: number): number {
  const ref = clef === "treble" ? 64 : 43; // E4 or G2 on the bottom line
  const steps = diatonicFromC0(midi) - diatonicFromC0(ref);
  return originY - steps * (lineGap / 2);
}

export function renderStaff(
  host: HTMLElement,
  notes: StaffNote[],
  options?: { clef?: Clef; showName?: boolean },
): void {
  const clef = options?.clef ?? (notes.some((note) => note.midi < 55) ? "bass" : "treble");
  const showName = options?.showName ?? false;
  const width = Math.max(520, notes.length * 56 + 140);
  const height = 170;
  const gap = 14;
  const originY = 86;
  const left = 78;

  const lines = [0, 1, 2, 3, 4].map((index) => {
    const y = originY - index * gap;
    return `<line x1="24" y1="${y}" x2="${width - 16}" y2="${y}" />`;
  });

  const heads = notes.map((note, index) => {
    const x = left + index * 56;
    const y = staffY(note.midi, clef, gap, originY);
    const cls = note.state === "now" ? "now" : note.state === "done" ? "done" : "";
    const ledger = ledgerLines(note.midi, clef, x, gap, originY);
    const acc = isBlackKey(note.midi) ? `<text class="acc" x="${x - 18}" y="${y + 5}">♯</text>` : "";
    const label = showName ? `<text class="name" x="${x}" y="158">${prettyName(note.midi)}</text>` : "";
    const stemUp = y > originY - gap * 2;
    const stem = stemUp
      ? `<line class="stem" x1="${x + 8}" y1="${y}" x2="${x + 8}" y2="${y - 36}" />`
      : `<line class="stem" x1="${x - 8}" y1="${y}" x2="${x - 8}" y2="${y + 36}" />`;
    return `${ledger}${acc}<ellipse class="head ${cls}" cx="${x}" cy="${y}" rx="9" ry="7" />${stem}${label}`;
  });

  host.innerHTML = `
    <svg class="staff" viewBox="0 0 ${width} ${height}" role="img" aria-label="Music staff">
      <text class="clef" x="30" y="${clef === "treble" ? originY - gap : originY - gap * 3}">${clef === "treble" ? "G" : "F"}</text>
      ${lines.join("")}
      ${heads.join("")}
    </svg>
  `;
}

function ledgerLines(midi: number, clef: Clef, x: number, gap: number, originY: number): string {
  const y = staffY(midi, clef, gap, originY);
  const top = originY - 4 * gap;
  const bottom = originY;
  const marks: string[] = [];
  if (y > bottom) {
    for (let line = bottom + gap; line <= y + 1; line += gap) {
      marks.push(`<line class="ledger" x1="${x - 16}" y1="${line}" x2="${x + 16}" y2="${line}" />`);
    }
  }
  if (y < top) {
    for (let line = top - gap; line >= y - 1; line -= gap) {
      marks.push(`<line class="ledger" x1="${x - 16}" y1="${line}" x2="${x + 16}" y2="${line}" />`);
    }
  }
  return marks.join("");
}
