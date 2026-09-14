import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import { clampNote } from "../music/notes";

const MODEL_URL = "/basic-pitch/model.json";
const MODEL_RATE = 22050;

let model: BasicPitch | null = null;

async function resampleToModel(buffer: AudioBuffer): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil(buffer.duration * MODEL_RATE));
  const offline = new OfflineAudioContext(1, frames, MODEL_RATE);
  const mono = offline.createBuffer(1, buffer.length, buffer.sampleRate);
  const dest = mono.getChannelData(0);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < dest.length; i++) dest[i] = (dest[i] ?? 0) + (data[i] ?? 0) / channels;
  }
  let peak = 0;
  for (let i = 0; i < dest.length; i++) peak = Math.max(peak, Math.abs(dest[i] ?? 0));
  if (peak > 0.02) {
    const gain = 0.95 / peak;
    for (let i = 0; i < dest.length; i++) dest[i] = (dest[i] ?? 0) * gain;
  }
  const source = offline.createBufferSource();
  source.buffer = mono;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

export async function runBasicPitchPath(buffer: AudioBuffer) {
  model ??= new BasicPitch(MODEL_URL);
  const samples = await resampleToModel(buffer);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await model.evaluateModel(
    samples,
    (frame, onset, contour) => {
      frames.push(...frame);
      onsets.push(...onset);
      contours.push(...contour);
    },
    () => {},
  );

  const duration = samples.length / MODEL_RATE;
  const decode = (onset: number, frame: number, minLen: number, energy: number) =>
    noteFramesToTime(
      addPitchBendsToNoteEvents(
        contours,
        outputToNotesPoly(frames, onsets, onset, frame, minLen, true, null, null, true, energy),
      ),
    );

  let events = decode(0.5, 0.3, 8, 11);
  const perSecond = events.length / Math.max(1, duration);
  if (perSecond > 7) events = decode(0.62, 0.35, 10, 14);
  else if (perSecond < 0.45) events = decode(0.4, 0.25, 5, 11);

  return events
    .map((event) => ({
      note: clampNote(event.pitchMidi),
      start: event.startTimeSeconds,
      duration: Math.max(0.03, event.durationSeconds),
      velocity: Math.round(40 + Math.min(1, Math.max(0, event.amplitude)) * 80),
    }))
    .sort((a, b) => a.start - b.start || a.note - b.note);
}
