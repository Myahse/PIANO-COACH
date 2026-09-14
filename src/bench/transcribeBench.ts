import { applySongLevel } from "../music/difficulty";
import { cleanTranscription } from "../music/cleanup";
import { transcribeAudio } from "../music/transcribe";
import { transcribeWithTranskun } from "../music/transkunEngine";
import { runBasicPitchPath } from "./basicPitchOnly";

const SONG_URL = "/bench/once-we-get-up-there.mp3";

type NoteStats = {
  count: number;
  durationSec: number;
  notesPerSec: number;
  pitchMin: number;
  pitchMax: number;
  medianPolyphony: number;
  shortNotesPct: number;
};

function stats(notes: { note: number; start: number; duration: number }[], durationSec: number): NoteStats {
  if (notes.length === 0) {
    return { count: 0, durationSec, notesPerSec: 0, pitchMin: 0, pitchMax: 0, medianPolyphony: 0, shortNotesPct: 0 };
  }
  const pitches = notes.map((n) => n.note);
  const concurrent = notes.map((note) =>
    1 + notes.filter((o) => o !== note && note.start >= o.start && note.start < o.start + o.duration * 0.65).length,
  );
  concurrent.sort((a, b) => a - b);
  const short = notes.filter((n) => n.duration < 0.12).length;
  return {
    count: notes.length,
    durationSec,
    notesPerSec: notes.length / Math.max(1, durationSec),
    pitchMin: Math.min(...pitches),
    pitchMax: Math.max(...pitches),
    medianPolyphony: concurrent[Math.floor(concurrent.length / 2)] ?? 1,
    shortNotesPct: Math.round((short / notes.length) * 100),
  };
}

async function decode(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  const bytes = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    await ctx.close().catch(() => {});
  }
}

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

async function main(): Promise<void> {
  setStatus("Decoding audio…");
  const audio = await decode(SONG_URL);
  const duration = audio.duration;

  setStatus("Running Transkun…");
  let transkunRaw: Awaited<ReturnType<typeof transcribeWithTranskun>> = [];
  let transkunError: string | undefined;
  try {
    transkunRaw = await transcribeWithTranskun(audio);
  } catch (e) {
    transkunError = e instanceof Error ? e.message : String(e);
  }

  setStatus("Running full pipeline…");
  const full = await transcribeAudio(audio, (pct, label) => {
    setStatus(`${label ?? "Converting"} ${pct}%`);
  });

  setStatus("Running Basic Pitch raw…");
  const basicRaw = await runBasicPitchPath(audio);

  const report = {
    song: "Once We Get Up There",
    durationSec: Math.round(duration * 10) / 10,
    transkunError,
    transkunRaw: stats(transkunRaw, duration),
    transkunAfterCleanup: stats(cleanTranscription(transkunRaw), duration),
    pipelineEngine: full.engine,
    pipelineFull: stats(full.fullNotes, duration),
    pipelinePlayable: stats(full.notes, duration),
    basicPitchRaw: stats(basicRaw, duration),
    basicPitchAfterCleanup: stats(cleanTranscription(basicRaw), duration),
    levels: {
      easy: stats(applySongLevel(full.fullNotes, "easy"), duration),
      medium: stats(applySongLevel(full.fullNotes, "medium"), duration),
      hard: stats(applySongLevel(full.fullNotes, "hard"), duration),
    },
  };

  (window as unknown as { __BENCH__: typeof report }).__BENCH__ = report;
  setStatus(JSON.stringify(report, null, 2));
  console.log("BENCH", report);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  setStatus(`Error: ${msg}`);
  (window as unknown as { __BENCH_ERROR__: string }).__BENCH_ERROR__ = msg;
});
