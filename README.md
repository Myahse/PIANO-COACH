# Piano Coach

Learn piano with falling notes, guided courses, and automatic transcription from MP3, MIDI, or MusicXML. Works in the browser and as a desktop app (Windows) via [Tauri](https://tauri.app/).

Connect a MIDI keyboard (USB or Bluetooth), import songs, and practice with Easy / Medium / Hard arrangements, sheet music, and a built-in note editor.

## Features

- **Play** — Falling-note roll synced to a virtual or connected keyboard
- **Course** — Step-by-step lessons plus practice on imported songs
- **Read** — Staff notation drills
- **Library** — Import and manage songs (MP3 transcription, MIDI, MusicXML)
- **Review** — Edit transcribed notes before playing
- **Desktop app** — Native Windows installer with optional MuScriptor / Transkun transcription backends

## Quick start (web)

**Requirements:** [Node.js](https://nodejs.org/) 20+

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

Production build:

```bash
npm run build
npm run preview
```

## Desktop app (Windows)

**Requirements:** Node.js 20+, [Rust](https://rustup.rs/) (for Tauri)

```bash
npm install
npm run tauri:dev      # development
npm run tauri:build      # installer → src-tauri/target/release/bundle/nsis/
```

## MP3 transcription (optional)

For high-quality MP3-to-MIDI transcription on desktop, set up the MuScriptor Python environment:

```powershell
.\scripts\setup-muscriptor.ps1
.\scripts\download-muscriptor-model.ps1
```

MuScriptor models are downloaded from Hugging Face (~5 GB for the large model). Accept the model license on Hugging Face before downloading.

A lighter in-browser fallback uses [Spotify Basic Pitch](https://github.com/spotify/basic-pitch) when Python backends are unavailable.

## Project structure

```
src/           TypeScript app (UI, lessons, live play, notation)
src-tauri/     Rust / Tauri desktop shell
scripts/       Python transcription helpers and setup scripts
public/        Static assets
```

## Contributing

Contributions are welcome. Please open an issue first for large changes, or send a pull request with a clear description of what you changed and why.

1. Fork the repo
2. Create a branch (`git checkout -b fix/my-feature`)
3. Commit your changes
4. Push and open a PR

Run `npm run build` before submitting.

## License

[MIT](LICENSE) — see [LICENSE](LICENSE) for details.

Third-party components (MuScriptor, Transkun, Basic Pitch, ONNX Runtime, etc.) remain under their respective licenses.
