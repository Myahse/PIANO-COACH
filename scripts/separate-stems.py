#!/usr/bin/env python3
"""Demucs two-stem separation — JSON result for Piano Coach desktop."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(msg or f"Command failed: {' '.join(cmd)}")


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: separate-stems.py <audio.wav>"}))
        return 1

    audio = Path(sys.argv[1]).resolve()
    if not audio.exists():
        print(json.dumps({"error": f"Audio not found: {audio}"}))
        return 1

    try:
        import demucs  # noqa: F401
    except ImportError:
        print(json.dumps({"error": "demucs is not installed in this Python environment"}))
        return 1

    with tempfile.TemporaryDirectory(prefix="piano-coach-stems-") as tmp:
        work = Path(tmp)
        out = work / "demucs"
        run(
            [
                sys.executable,
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
            print(json.dumps({"error": "Demucs did not produce vocal/backing stems"}))
            return 1

        print(
            json.dumps(
                {
                    "backend": "demucs",
                    "vocal": str(vocal),
                    "instruments": str(backing),
                }
            )
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
