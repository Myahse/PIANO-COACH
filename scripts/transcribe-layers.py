#!/usr/bin/env python3
"""Audio → layered notes (Demucs stem split + Transkun + Basic Pitch)."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(r"C:\piano-coach-transkun")
VENV = ROOT / "venv"
PYTHON = VENV / "Scripts" / "python.exe"
TRANSKUN = VENV / "Scripts" / "transkun.exe"
BASIC_PITCH = VENV / "Scripts" / "basic-pitch.exe"


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(msg or f"Command failed: {' '.join(cmd)}")


def module_ok(module: str) -> bool:
    proc = subprocess.run([str(PYTHON), "-c", f"import {module}"], capture_output=True, text=True)
    return proc.returncode == 0


def separate(audio: Path, work: Path) -> tuple[Path, Path]:
    out = work / "demucs"
    run(
        [
            str(PYTHON),
            "-m",
            "demucs",
            "--two-stems",
            "vocals",
            "-d",
            "cpu",
            str(audio),
            "-o",
            str(out),
        ]
    )
    stem_dir = next(out.glob(f"*/{audio.stem}"))
    vocal = stem_dir / "vocals.wav"
    backing = stem_dir / "no_vocals.wav"
    if not vocal.exists() or not backing.exists():
        raise RuntimeError("Demucs did not produce vocal/backing stems.")
    return vocal, backing


def transkun_mid(audio: Path, work: Path) -> Path:
    mid = work / "inst.mid"
    run([str(TRANSKUN), str(audio), str(mid), "--device", "cpu"])
    return mid


def basic_pitch_mid(wav: Path, work: Path) -> Path | None:
    out = work / "basic-pitch"
    out.mkdir(parents=True, exist_ok=True)
    cmd = [str(BASIC_PITCH), str(wav), str(out)] if BASIC_PITCH.exists() else [
        str(PYTHON),
        "-m",
        "basic_pitch.inference",
        str(wav),
        str(out),
    ]
    run(cmd)
    mids = sorted(out.glob("*.mid"))
    return mids[0] if mids else None


def parse_midi(path: Path) -> list[dict]:
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

    for note, (start, vel) in open_notes.items():
        notes.append({"note": int(note), "start": round(start, 4), "duration": 0.2, "velocity": int(vel)})

    notes.sort(key=lambda n: (n["start"], n["note"]))
    return notes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--target", choices=("piano", "vocals", "both"), default="both")
    args = parser.parse_args()

    if not TRANSKUN.exists():
        print(json.dumps({"error": "Transkun not installed. Run scripts/setup-python-transkun.ps1"}))
        return 1

    audio = Path(args.audio).resolve()
    if not audio.exists():
        print(json.dumps({"error": f"File not found: {audio}"}))
        return 1

    work = Path(tempfile.mkdtemp(prefix="piano-coach-layers-"))
    try:
        vocal_path: Path = audio
        inst_path: Path = audio
        engine = "transkun"

        if module_ok("demucs"):
            try:
                vocal_path, inst_path = separate(audio, work)
                engine = "demucs+transkun"
            except RuntimeError as err:
                print(f"Demucs failed, using full mix: {err}", file=sys.stderr)

        voice_notes: list[dict] = []
        inst_notes: list[dict] = []

        if args.target in ("piano", "both"):
            inst_notes = parse_midi(transkun_mid(inst_path, work))

        if args.target in ("vocals", "both") and (BASIC_PITCH.exists() or module_ok("basic_pitch")):
            try:
                vocal_mid = basic_pitch_mid(vocal_path, work)
                if vocal_mid:
                    voice_notes = parse_midi(vocal_mid)
            except RuntimeError as err:
                print(f"Vocal transcription failed: {err}", file=sys.stderr)

        if not voice_notes and not inst_notes:
            print(json.dumps({"error": "No notes were found."}))
            return 1

        print(json.dumps({"engine": engine, "voiceNotes": voice_notes, "instNotes": inst_notes}))
        return 0
    except RuntimeError as err:
        print(json.dumps({"error": str(err)}))
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
