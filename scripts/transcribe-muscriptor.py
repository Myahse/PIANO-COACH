#!/usr/bin/env python3
"""Audio → notes via MuScriptor (https://github.com/muscriptor/muscriptor)."""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

PIANO_PROGRAMS = set(range(0, 8))


@contextmanager
def silence_stdout():
    """MuScriptor prints timing logs to stdout; keep our JSON output clean."""
    old = sys.stdout
    sys.stdout = io.StringIO()
    try:
        yield
    finally:
        sys.stdout = old


def progress(pct: int, label: str) -> None:
    print(json.dumps({"progress": pct, "label": label}), file=sys.stderr, flush=True)


class heartbeat:
    """Emit progress while a long blocking call runs (model download, transcribe)."""

    def __init__(self, pct: int, label: str, *, step_pct: float = 1.0, interval: float = 15.0):
        self.base_pct = pct
        self.label = label
        self.step_pct = step_pct
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._started = 0.0

    def __enter__(self) -> "heartbeat":
        self._started = time.monotonic()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1)

    def _run(self) -> None:
        tick = 0
        while not self._stop.wait(self.interval):
            tick += 1
            elapsed = int(time.monotonic() - self._started)
            mins, secs = divmod(elapsed, 60)
            when = f"{mins}m {secs}s" if mins else f"{secs}s"
            pct = min(84, self.base_pct + int(tick * self.step_pct))
            progress(pct, f"{self.label} · {when} elapsed")


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def fast_mode_default() -> bool:
    """Batch GPU chunks (~3–4× faster, worse accuracy across 5s chunk edges). Off by default."""
    return env_flag("PIANO_COACH_MUSCRIPTOR_FAST", False)


def beam_size_default() -> int:
    raw = os.environ.get("PIANO_COACH_MUSCRIPTOR_BEAM", "1")
    try:
        return max(1, min(4, int(raw)))
    except ValueError:
        return 1


def cfg_coef_default() -> float:
    raw = os.environ.get("PIANO_COACH_MUSCRIPTOR_CFG", "1.0")
    try:
        return max(1.0, min(2.0, float(raw)))
    except ValueError:
        return 1.0


def transcribe_kwargs(fast: bool, device_type: str) -> dict:
    if fast and device_type in ("cuda", "mps"):
        return {
            "prelude_forcing": False,
            "batch_size": 4,
            "beam_size": 1,
        }
    kwargs: dict = {
        "prelude_forcing": True,
        "batch_size": 1,
        "beam_size": beam_size_default(),
    }
    cfg = cfg_coef_default()
    if cfg > 1.0:
        kwargs["cfg_coef"] = cfg
    return kwargs


def friendly_error(err: Exception) -> str:
    text = str(err)
    lower = text.lower()
    if "gated" in lower or "modeldownloaderror" in lower or "403" in lower:
        return (
            "MuScriptor model access required. Log in with hf auth login, then accept the license at "
            "https://huggingface.co/MuScriptor/muscriptor-large and retry."
        )
    if "cannot download" in lower and "huggingface" in lower:
        return (
            "MuScriptor model access required. Log in with hf auth login, then accept the license at "
            "https://huggingface.co/MuScriptor/muscriptor-large and retry."
        )
    return text


def instruments_for(target: str) -> list[str] | None:
    if target == "piano":
        return ["acoustic_piano"]
    if target == "vocals":
        return ["voice"]
    return ["acoustic_piano", "voice"]


def parse_track_notes(track, ticks_per_beat: int, tempo: int) -> tuple[list[dict], set[int]]:
    import mido

    notes: list[dict] = []
    programs: set[int] = set()
    t = 0.0
    open_notes: dict[tuple[int, int], tuple[float, int]] = {}

    for msg in track:
        t += mido.tick2second(msg.time, ticks_per_beat, tempo)
        if msg.type == "set_tempo":
            tempo = msg.tempo
        elif msg.type == "program_change":
            programs.add(msg.program)
        elif msg.type == "note_on" and msg.velocity > 0:
            open_notes[(msg.channel, msg.note)] = (t, msg.velocity)
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            hit = open_notes.pop((msg.channel, msg.note), None)
            if hit:
                start, vel = hit
                notes.append(
                    {
                        "note": int(msg.note),
                        "start": round(start, 4),
                        "duration": round(max(0.05, t - start), 4),
                        "velocity": int(vel),
                    }
                )

    for (channel, note), (start, vel) in open_notes.items():
        notes.append(
            {
                "note": int(note),
                "start": round(start, 4),
                "duration": 0.2,
                "velocity": int(vel),
            }
        )

    return notes, programs


def parse_midi_layers(path: Path, target: str) -> tuple[list[dict], list[dict]]:
    import mido

    midi = mido.MidiFile(str(path))
    ticks_per_beat = midi.ticks_per_beat or 480
    inst: list[dict] = []
    voice: list[dict] = []

    for track in midi.tracks:
        tempo = 500_000
        notes, programs = parse_track_notes(track, ticks_per_beat, tempo)
        if not notes:
            continue
        name = getattr(track, "name", "") or ""
        is_piano = bool(programs & PIANO_PROGRAMS) or "piano" in name.lower()
        if target == "piano":
            inst.extend(notes)
        elif target == "vocals":
            voice.extend(notes)
        elif is_piano:
            inst.extend(notes)
        else:
            voice.extend(notes)

    if target == "both" and not voice and not inst:
        all_notes = parse_midi_flat(path)
        inst = all_notes

    inst.sort(key=lambda n: (n["start"], n["note"]))
    voice.sort(key=lambda n: (n["start"], n["note"]))
    return inst, voice


def parse_midi_flat(path: Path) -> list[dict]:
    import mido

    notes: list[dict] = []
    tempo = 500_000
    ticks_per_beat = 480
    open_notes: dict[int, tuple[float, int]] = {}

    for track in mido.MidiFile(str(path)).tracks:
        t = 0.0
        for msg in track:
            t += mido.tick2second(msg.time, ticks_per_beat, tempo)
            if msg.type == "set_tempo":
                tempo = msg.tempo
            elif msg.type == "note_on" and msg.velocity > 0:
                open_notes[msg.note] = (t, msg.velocity)
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                hit = open_notes.pop(msg.note, None)
                if hit:
                    start, vel = hit
                    notes.append(
                        {
                            "note": int(msg.note),
                            "start": round(start, 4),
                            "duration": round(max(0.05, t - start), 4),
                            "velocity": int(vel),
                        }
                    )

    notes.sort(key=lambda n: (n["start"], n["note"]))
    return notes


def model_weights_cached(model: str) -> bool:
    snapshots = Path.home() / ".cache" / "huggingface" / "hub" / f"models--MuScriptor--muscriptor-{model}" / "snapshots"
    if not snapshots.is_dir():
        return False
    return any((snap / "model.safetensors").is_file() for snap in snapshots.iterdir() if snap.is_dir())


def download_blob_bytes(model: str) -> tuple[int, int]:
    """Return (downloaded_bytes, expected_bytes) for an in-progress or finished download."""
    from huggingface_hub import get_hf_file_metadata, hf_hub_url

    repo = f"MuScriptor/muscriptor-{model}"
    try:
        total = int(get_hf_file_metadata(hf_hub_url(repo, "model.safetensors")).size or 0)
    except Exception:
        total = 0

    got = 0
    blobs = Path.home() / ".cache" / "huggingface" / "hub" / f"models--MuScriptor--muscriptor-{model}" / "blobs"
    if blobs.is_dir():
        for path in blobs.iterdir():
            if not path.is_file():
                continue
            got = max(got, path.stat().st_size)
    snapshots = Path.home() / ".cache" / "huggingface" / "hub" / f"models--MuScriptor--muscriptor-{model}" / "snapshots"
    if snapshots.is_dir():
        for snap in snapshots.iterdir():
            weights = snap / "model.safetensors"
            if weights.is_file():
                size = weights.stat().st_size
                got = max(got, size)
                total = max(total, size)
    return got, total


def ensure_model_downloaded(model: str) -> None:
    """Download gated weights once, with visible progress (large ≈ 5.5 GB)."""
    if model_weights_cached(model):
        return

    from huggingface_hub import hf_hub_download

    got, total = download_blob_bytes(model)
    if total > 0:
        gb = total / 1e9
        progress(12, f"Downloading muscriptor-{model} model ({gb:.1f} GB, first time only)")
    else:
        progress(12, f"Downloading muscriptor-{model} model (first time only)")

    err: list[Exception] = []
    done = threading.Event()

    def run() -> None:
        try:
            hf_hub_download(repo_id=f"MuScriptor/muscriptor-{model}", filename="model.safetensors")
        except Exception as exc:  # noqa: BLE001
            err.append(exc)
        finally:
            done.set()

    threading.Thread(target=run, daemon=True).start()
    started = time.monotonic()
    last_pct = -1
    while not done.wait(2):
        got, total = download_blob_bytes(model)
        elapsed = int(time.monotonic() - started)
        mins, secs = divmod(elapsed, 60)
        when = f"{mins}m {secs}s" if mins else f"{secs}s"
        if total > 0 and got > 0:
            pct = min(99, int(100 * got / total))
            if pct != last_pct:
                last_pct = pct
                progress(
                    12 + int(pct * 0.08),
                    f"Downloading model · {pct}% ({got / 1e9:.1f}/{total / 1e9:.1f} GB) · {when}",
                )
        else:
            progress(15, f"Downloading model · starting… · {when}")

    if err:
        raise err[0]
    progress(20, "Detecting Notes · download complete")


def transcribe_to_midi_with_progress(
    transcription_model,
    audio: Path,
    instruments: list[str] | None,
    fast: bool,
    on_chunk: Callable[[int, int], None],
) -> bytes:
    from muscriptor.events import ProgressEvent

    device_type = transcription_model._device.type
    kwargs = transcribe_kwargs(fast, device_type)
    if instruments:
        kwargs["instruments"] = instruments

    with silence_stdout():
        beat_grid = transcription_model.detect_beat_grid_for(str(audio))

        def event_stream():
            for ev in transcription_model.transcribe(str(audio), **kwargs):
                if isinstance(ev, ProgressEvent):
                    on_chunk(ev.completed, ev.total)
                else:
                    yield ev

        return transcription_model.events_to_midi_bytes(event_stream(), beat_grid=beat_grid)


def run_transcription(
    audio: Path,
    target: str,
    model: str,
    *,
    fast: bool,
    cached_model=None,
) -> tuple[dict, object | None]:
    from muscriptor import TranscriptionModel

    transcription_model = cached_model
    if transcription_model is None:
        ensure_model_downloaded(model)
        progress(21, "Detecting Notes · loading model into GPU")
        with heartbeat(21, "Detecting Notes · loading model into GPU", step_pct=0, interval=20), silence_stdout():
            transcription_model = TranscriptionModel.load_model(model)
        progress(28, "Detecting Notes · model ready")

    device_type = transcription_model._device.type
    if fast and device_type in ("cuda", "mps"):
        mode = "batched GPU (fast)"
    else:
        beam = beam_size_default()
        mode = f"quality · beam {beam}" if beam > 1 else "quality · sequential chunks"
    progress(32, f"Detecting Notes · {mode}")

    instruments = instruments_for(target)
    work = Path(tempfile.mkdtemp(prefix="piano-coach-muscriptor-"))
    out = work / "muscriptor.mid"

    def on_chunk(completed: int, total: int) -> None:
        if total <= 0:
            return
        pct = 35 + int((completed / total) * 49)
        progress(pct, f"Detecting Notes · chunk {completed}/{total}")

    progress(35, "Detecting Notes · transcribing")
    with heartbeat(35, "Detecting Notes · transcribing", step_pct=0, interval=30), silence_stdout():
        midi_bytes = transcribe_to_midi_with_progress(
            transcription_model, audio, instruments, fast, on_chunk
        )

    out.write_bytes(midi_bytes)
    progress(85, "Creating Score · reading notes")
    inst_notes, voice_notes = parse_midi_layers(out, target)

    if target in ("piano", "both") and not inst_notes:
        inst_notes = parse_midi_flat(out)
    if target == "vocals" and not voice_notes:
        voice_notes = parse_midi_flat(out)

    shutil.rmtree(work, ignore_errors=True)

    if not inst_notes and not voice_notes:
        raise RuntimeError("No notes were found.")

    progress(95, "Creating Score")
    result = {
        "engine": f"muscriptor-{model}" + ("-fast" if fast and device_type in ("cuda", "mps") else ""),
        "voiceNotes": voice_notes,
        "instNotes": inst_notes,
    }
    return result, transcription_model


def worker_loop(model: str, fast: bool) -> int:
    """Long-lived process: load model once, accept JSON requests on stdin."""
    from muscriptor import TranscriptionModel

    progress(10, "Detecting Notes · warming MuScriptor model")
    ensure_model_downloaded(model)
    with silence_stdout():
        cached = TranscriptionModel.load_model(model)
    progress(15, "Detecting Notes · model ready (worker)")
    print(json.dumps({"ready": True, "model": model, "fast": fast}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({"error": "Invalid JSON request"}), flush=True)
            continue

        if req.get("cmd") == "shutdown":
            break

        audio_path = Path(req.get("audio", "")).resolve()
        target = req.get("target", "both")
        if not audio_path.exists():
            print(json.dumps({"error": f"File not found: {audio_path}"}), flush=True)
            continue

        try:
            progress(8, "Processing Audio")
            result, cached = run_transcription(
                audio_path, target, model, fast=req.get("fast", fast), cached_model=cached
            )
            print(json.dumps(result), flush=True)
        except Exception as err:  # noqa: BLE001
            print(json.dumps({"error": friendly_error(err)}), flush=True)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", nargs="?")
    parser.add_argument("--target", choices=("piano", "vocals", "both"), default="both")
    parser.add_argument("--model", default="large")
    parser.add_argument("--fast", action=argparse.BooleanOptionalAction, default=fast_mode_default())
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.worker:
        return worker_loop(args.model, args.fast)

    if not args.audio:
        print(json.dumps({"error": "Audio path required"}))
        return 1

    audio = Path(args.audio).resolve()
    if not audio.exists():
        print(json.dumps({"error": f"File not found: {audio}"}))
        return 1

    progress(8, "Processing Audio")
    try:
        result, _ = run_transcription(audio, args.target, args.model, fast=args.fast)
        print(json.dumps(result))
        return 0
    except Exception as err:  # noqa: BLE001
        print(json.dumps({"error": friendly_error(err)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
