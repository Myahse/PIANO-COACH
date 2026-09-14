import { audioBufferToWavFile } from "../audio/wavFile";
import { Metronome } from "../audio/metronome";
import { PianoSynth } from "../audio/pianoSynth";
import {
  LEVELS,
  UNITS,
  UNIT_BLURBS,
  levelTimedNotes,
  type Hand,
  type LevelDef,
} from "../lessons/curriculum";
import { LessonEngine, type LessonSnapshot } from "../lessons/engine";
import { loadGame } from "../lessons/game";
import { clearedCount, isUnlocked, nextIncompleteId, type Stars } from "../lessons/progress";
import { NoteEditor } from "../live/noteEditor";
import { PianoRoll } from "../live/roll";
import { COUNT_IN, LiveSession } from "../live/session";
import { MidiService } from "../midi/midiService";
import type { MidiEvent } from "../midi/types";
import {
  clearLibrary,
  deleteLibraryPiece,
  getLibraryAudioBytes,
  listLibraryPieces,
  saveLibraryPiece,
  wipeOldLibraryOnce,
} from "../music/library";
import { parseMidi, writeMidi } from "../music/midiFile";
import { isMusicXmlFile, loadMusicXmlText, parseMusicXml } from "../music/musicXmlFile";
import { prettyChord, prettyName } from "../music/notes";
import { pieceDuration, type Piece, type TimedNote } from "../music/timed";
import { fixSemitoneSlips, limitExtremeFlood, polishHardChords } from "../music/cleanup";
import { refineNoteDurations } from "../music/duration";
import { applySongLevel, normalizeSongLevel, sourceNotesForLevel, type SongLevel } from "../music/difficulty";
import { KEY_TONIC_OPTIONS, normalizeKeyPreference, resolveSongKey } from "../music/keys";
import { applyEditedNotesForLevel, getEditableNotesForLevel } from "../music/noteLayers";
import { writeMusicXml } from "../music/musicXmlWrite";
import {
  applyTileMode,
  normalizeTileMode,
  normalizeTranscribeTarget,
  transcribeAudioFile,
  type TranscribeTarget,
} from "../music/transcribe";
import { IMPORT_STEPS, resolveImportProgress, stepIndex, type ImportStepId } from "../music/importSteps";
import { MUSCRIPTOR_LABEL, muScriptorDevice, probeMuScriptor } from "../music/muscriptor";
import { READING_LEVELS, READING_UNITS, READING_UNIT_BLURBS } from "../notation/curriculum";
import { ReadingEngine, type ReadingSnapshot } from "../notation/engine";
import { ScoreView } from "../notation/score";
import { renderStaff, type StaffNote } from "../notation/staff";
import { PianoView } from "./piano";

type Mode = "learn" | "read" | "live" | "library" | "free";

function starText(stars: Stars | number): string {
  return "★★★".slice(0, stars) + "☆☆☆".slice(stars);
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function handLabel(hand?: Hand | string | null): string {
  if (hand === "left") return "Left hand";
  if (hand === "both") return "Hands together";
  if (hand === "right") return "Right hand";
  return "";
}

function handShort(hand?: Hand | string | null): string {
  if (hand === "left") return "LH";
  if (hand === "both") return "2H";
  if (hand === "right") return "RH";
  return "";
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

export function mountApp(host: HTMLElement): void {
  const midi = new MidiService();
  const lessons = new LessonEngine();
  const reading = new ReadingEngine();
  const live = new LiveSession();
  const metronome = new Metronome();
  const synth = new PianoSynth();
  synth.setEnabled(localStorage.getItem("piano-coach-sound") !== "off");
  const piano = new PianoView({
    onNoteOn: (note, velocity) => midi.emit({ type: "noteon", note, velocity, timestamp: performance.now() }),
    onNoteOff: (note) => midi.emit({ type: "noteoff", note, velocity: 0, timestamp: performance.now() }),
  });
  const roll = new PianoRoll(piano);
  const score = new ScoreView();
  live.setGuide((note, on, velocity) => {
    if (on) {
      const vel = live.guideVelocity(velocity);
      if (vel > 0) synth.noteOn(note, vel);
    } else synth.noteOff(note);
  });

  let mode: Mode = "learn";
  let saved: Piece[] = [];
  let raf = 0;

  host.innerHTML = `
    <div class="app ss-app">
      <aside class="ss-sidebar">
        <div class="ss-brand">
          <span class="mark" aria-hidden="true"></span>
          <div>
            <h1 class="ss-logo">Piano Coach</h1>
          </div>
        </div>
        <button type="button" class="primary ss-new" data-new-import>+ New song</button>
        <input type="file" class="hidden" accept=".mid,.midi,.musicxml,.mxl,.xml,.mp3,.wav,.ogg,.m4a,audio/*,audio/midi" data-import />
        <nav class="ss-nav" aria-label="Main">
          <button type="button" class="ss-nav-item active" data-mode="live">Play</button>
          <button type="button" class="ss-nav-item" data-mode="library">My songs</button>
          <button type="button" class="ss-nav-item" data-mode="learn">Course</button>
          <button type="button" class="ss-nav-item" data-mode="read">Read</button>
          <button type="button" class="ss-nav-item" data-mode="free">Free play</button>
        </nav>
        <div class="ss-recents">
          <p class="ss-recents-label">Recent</p>
          <div class="ss-recents-list" data-sidebar-recents></div>
        </div>
        <div class="ss-sidebar-foot" data-connect>
          <button type="button" class="ghost ss-connect" data-connect-btn>Connect MIDI</button>
          <label class="device-pick hidden">
            <select data-device-select></select>
          </label>
          <p class="hint ss-connect-hint" data-connect-hint>USB keyboard or tap keys</p>
          <p class="error hidden" data-midi-error></p>
          <div class="ss-foot-row">
            <div class="midi-status compact" data-midi-status>
              <span class="dot"></span>
              <span data-midi-label>MIDI</span>
            </div>
            <button type="button" class="chip" data-sound>Sound</button>
          </div>
        </div>
      </aside>

      <div class="ss-main">
      <p class="hidden" data-connect-blurb></p>
      <p class="eyebrow hidden" data-eyebrow>Learn path</p>

      <section class="path-card ss-panel" data-path></section>

      <section class="stage ss-panel" data-stage hidden>
        <div class="prompt-card" data-flash>
          <div class="lesson-kicker">
            <p class="mode-title" data-title>Free play</p>
            <span class="hand-badge" data-hand hidden></span>
          </div>
          <p class="skill" data-skill></p>
          <div class="course" data-course hidden></div>
          <p class="fingering" data-fingers hidden></p>
          <div class="staff-host" data-staff hidden></div>
          <p class="big-note" data-big-note>—</p>
          <p class="prompt" data-prompt></p>
          <div class="win-banner hidden" data-win>
            <strong data-win-title>Lesson complete</strong>
            <span data-win-xp></span>
          </div>
          <div class="stats">
            <div><span data-progress>0</span><label data-progress-label>progress</label></div>
            <div><span data-streak>0</span><label>streak</label></div>
            <div><span data-wrong>0</span><label>missed</label></div>
          </div>
        </div>

        <aside class="controls">
          <div class="control-block" data-teach-block>
            <p class="teach" data-teach></p>
          </div>
          <div class="control-block">
            <div class="row">
              <button type="button" class="ghost hidden" data-back>Path</button>
              <button type="button" class="ghost" data-restart>Restart</button>
              <button type="button" class="primary hidden" data-next>Next level</button>
            </div>
            <div class="row">
              <button type="button" class="ghost" data-metro>Metronome</button>
            </div>
            <label class="tempo">Tempo
              <input type="range" min="50" max="140" value="80" data-tempo />
              <span data-tempo-label>80</span>
            </label>
          </div>
        </aside>
      </section>

      <div class="course-practice-dock hidden" data-course-practice>
        <div class="course-audio-toggles hidden" data-course-audio>
          <label class="toggle"><input type="checkbox" data-course-hear-song checked /> Original</label>
          <label class="toggle"><input type="checkbox" data-course-hear-notes /> Guide piano</label>
        </div>
        <div class="course-roll-host hidden" data-course-roll></div>
        <div class="course-keys-stack" data-course-keys></div>
      </div>

      <section class="library-card ss-panel" data-library hidden>
        <div class="library-head">
          <div>
            <h2>Your library</h2>
            <p>Songs you transcribed. Import new ones from the <strong>Play</strong> tab.</p>
          </div>
          <button type="button" class="ghost danger" data-library-empty hidden>Empty library</button>
        </div>
        <label class="file-pick import-box library-import" data-library-import-box>
          Drop a file here, or use the Play tab
          <input type="file" accept=".mid,.midi,.musicxml,.mxl,.xml,.mp3,.wav,.ogg,.m4a,audio/*,audio/midi" data-library-import />
        </label>
        <div class="import-progress hidden" data-library-progress><i data-library-bar></i></div>
        <p class="hint" data-library-status>Nothing imported yet.</p>
        <div class="library-list" data-library-list></div>
      </section>

      <section class="ss-playroom" data-live hidden>
        <header class="ss-song-bar">
          <div class="ss-song-info">
            <h2 data-live-title>Select a song</h2>
            <p class="ss-song-meta" data-song-meta>Drop a song or pick from Recent</p>
          </div>
          <div class="ss-song-actions">
            <button type="button" class="ghost" data-settings-toggle>Settings</button>
            <button type="button" class="ghost" data-retranscribe hidden>Re-transcribe</button>
            <button type="button" class="ghost" data-export hidden>MIDI</button>
            <button type="button" class="ghost" data-export-xml hidden>MusicXML</button>
            <button type="button" class="ghost danger" data-library-remove hidden>Delete</button>
          </div>
        </header>
        <div class="ss-settings-panel hidden" data-settings-panel>
          <label class="file-pick import-box live-import" data-import-box>
            Drop MP3, MIDI, or MusicXML
            <input type="file" accept=".mid,.midi,.musicxml,.mxl,.xml,.mp3,.wav,.ogg,.m4a,audio/*,audio/midi" data-import-secondary />
          </label>
          <div class="import-progress hidden" data-import-progress><i data-import-bar></i></div>
          <p class="hint" data-import-status>Drop a song to transcribe it.</p>
          <div class="live-grid ss-settings-grid">
            <label>Transcribe
              <select data-transcribe-target>
                <option value="both" selected>Piano + vocals</option>
                <option value="piano">Piano only</option>
                <option value="vocals">Vocals only</option>
              </select>
            </label>
            <label>Track
              <select data-tile-mode>
                <option value="voice" selected>Vocals (follows song)</option>
                <option value="instruments">Piano</option>
                <option value="both">All</option>
                <option value="left">Left hand</option>
                <option value="right">Right hand</option>
              </select>
            </label>
            <label>Song <select data-piece-select></select></label>
            <label>Level
              <select data-song-level>
                <option value="easy" selected>Easy · vocals</option>
                <option value="medium">Medium · vocals + chords</option>
                <option value="hard">Hard · full song</option>
              </select>
            </label>
            <label>Key
              <select data-song-key></select>
            </label>
            <label>Scale
              <select data-song-mode>
                <option value="auto" selected>Auto</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
              </select>
            </label>
            <label class="toggle"><input type="checkbox" data-hear-song checked /> Original</label>
            <label class="toggle"><input type="checkbox" data-hear-notes /> Guide</label>
            <label class="toggle"><input type="checkbox" data-wait-for-me /> Wait for me</label>
            <label class="toggle"><input type="checkbox" data-show-sheet checked /> Sheet</label>
          </div>
        </div>
        <div class="ss-view-tabs hidden" data-view-tabs>
          <button type="button" class="chip" data-play-view="review">Review</button>
          <button type="button" class="chip active" data-play-view="play">Play</button>
        </div>
        <div class="ss-workspace piano-dock" data-workspace>
          <div class="play-stage" data-play-stage>
            <div class="play-main" data-play-main>
              <aside class="sheet-window" data-sheet-window>
                <div class="sheet-window-head">
                  <h3>Sheet music</h3>
                  <div class="sheet-tools">
                    <div class="zoom-controls">
                      <button type="button" class="ghost zoom-btn" data-zoom-out aria-label="Zoom out">−</button>
                      <span data-zoom-label>90%</span>
                      <button type="button" class="ghost zoom-btn" data-zoom-in aria-label="Zoom in">+</button>
                    </div>
                  </div>
                </div>
                <div data-score></div>
              </aside>
              <div class="keys-column">
                <div class="play-roll-host" data-roll></div>
                <div class="keyboard-stack" data-keyboard-stack></div>
              </div>
            </div>
            <aside class="track-panel hidden" data-track-panel hidden aria-hidden="true"></aside>
          </div>
        </div>
        <footer class="ss-transport" data-play-transport>
          <div class="ss-transport-left">
            <label class="ss-audio-toggle"><input type="checkbox" data-hear-song-transport checked /> Original</label>
            <label class="ss-audio-toggle"><input type="checkbox" data-hear-notes-transport /> Guide piano</label>
          </div>
          <div class="ss-transport-center">
            <button type="button" class="ghost ss-transport-btn" data-live-back aria-label="Back 5 seconds">−5s</button>
            <button type="button" class="ghost ss-transport-btn" data-live-prev aria-label="Previous note">◀</button>
            <button type="button" class="ghost ss-transport-btn" data-live-stop>Stop</button>
            <button type="button" class="primary ss-play-btn" data-live-play>Play</button>
            <button type="button" class="ghost ss-transport-btn" data-live-next aria-label="Next note">▶</button>
            <button type="button" class="ghost ss-transport-btn" data-live-forward aria-label="Forward 5 seconds">+5s</button>
            <input type="range" class="ss-seek" data-live-seek min="0" max="100" value="0" step="0.05" aria-label="Song position" />
            <span class="ss-time" data-live-time>0:00 / 0:00</span>
          </div>
          <div class="ss-transport-right live-stats">
            <span><strong data-live-hits>0</strong> hits</span>
            <span><strong data-live-combo>0</strong> combo</span>
            <span><strong data-live-miss>0</strong> miss</span>
            <button type="button" class="ghost ss-transport-btn" data-live-metro>Metro</button>
          </div>
        </footer>
      </section>

      <section class="sequence-strip" data-sequence hidden></section>

      <div class="import-overlay hidden" data-import-overlay aria-live="polite">
        <div class="import-steps-card">
          <h3>Transcribing your song</h3>
          <p class="import-file-name" data-import-file-name></p>
          <ol class="import-steps" data-import-steps></ol>
          <div class="import-progress import-overlay-bar"><i data-import-overlay-bar></i></div>
          <p class="import-step-detail" data-import-step-detail></p>
          <button type="button" class="ghost import-dismiss hidden" data-import-dismiss>Dismiss</button>
        </div>
      </div>
      </div>
    </div>
  `;

  const rollHost = host.querySelector("[data-roll]");
  const playMain = host.querySelector("[data-play-main]");
  const playStageEl = host.querySelector("[data-play-stage]");
  const workspace = host.querySelector("[data-workspace]");
  const keyboardStack = host.querySelector("[data-keyboard-stack]");
  const noteEditor = new NoteEditor();
  playMain?.prepend(noteEditor.root);
  rollHost?.append(roll.canvas);
  keyboardStack?.append(piano.root);
  host.querySelector("[data-score]")?.append(score.root);
  score.setZoom(0.9);

  const $ = <T extends Element>(selector: string) => {
    const node = host.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node as T;
  };

  const isDesktopApp = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  const connectBlurb = $("[data-connect-blurb]");
  const connectHint = $("[data-connect-hint]");
  if (isDesktopApp) {
    connectBlurb.textContent =
      "Use the USB-C cable from the EP-10 to this computer, then click Connect USB MIDI.";
    connectHint.textContent = "Use Transcribe & play — drop a song like Songscription.";
  } else {
    connectHint.textContent = "Chrome or Edge works best on Windows. You can also tap the keys on screen.";
  }

  const connectBtn = $<HTMLButtonElement>("[data-connect-btn]");
  const deviceSelect = $<HTMLSelectElement>("[data-device-select]");
  const midiLabel = $("[data-midi-label]");
  const midiStatus = $("[data-midi-status]");
  const midiError = $("[data-midi-error]");
  const devicePick = $("label.device-pick");
  const pathEl = $<HTMLElement>("[data-path]");
  const stageEl = $<HTMLElement>("[data-stage]");
  const libraryEl = $<HTMLElement>("[data-library]");
  const libraryList = $<HTMLElement>("[data-library-list]");
  const libraryStatus = $("[data-library-status]");
  const libraryImportInput = $<HTMLInputElement>("[data-library-import]");
  const libraryImportBox = $<HTMLElement>("[data-library-import-box]");
  const libraryProgress = $<HTMLElement>("[data-library-progress]");
  const libraryBar = $<HTMLElement>("[data-library-bar]");
  const libraryEmptyBtn = $<HTMLButtonElement>("[data-library-empty]");
  const liveEl = $<HTMLElement>("[data-live]");
  const titleEl = $("[data-title]");
  const skillEl = $("[data-skill]");
  const courseEl = $<HTMLElement>("[data-course]");
  const handEl = $<HTMLElement>("[data-hand]");
  const fingersEl = $<HTMLElement>("[data-fingers]");
  const bigNote = $("[data-big-note]");
  const promptEl = $("[data-prompt]");
  const teachEl = $("[data-teach]");
  const teachBlock = $("[data-teach-block]");
  const winEl = $<HTMLElement>("[data-win]");
  const winXp = $("[data-win-xp]");
  const winTitle = $("[data-win-title]");
  const staffHost = $<HTMLElement>("[data-staff]");
  const progressEl = $("[data-progress]");
  const progressLabel = $("[data-progress-label]");
  const streakEl = $("[data-streak]");
  const wrongEl = $("[data-wrong]");
  const flash = $<HTMLElement>("[data-flash]");
  const sequenceStrip = $<HTMLElement>("[data-sequence]");
  const coursePracticeDock = $<HTMLElement>("[data-course-practice]");
  const courseAudioToggles = $<HTMLElement>("[data-course-audio]");
  const courseHearSongToggle = $<HTMLInputElement>("[data-course-hear-song]");
  const courseHearNotesToggle = $<HTMLInputElement>("[data-course-hear-notes]");
  const courseRollHost = $<HTMLElement>("[data-course-roll]");
  const courseKeysHost = $<HTMLElement>("[data-course-keys]");
  const COURSE_PIECE_KEY = "piano-coach-course-piece";
  const tempoInput = $<HTMLInputElement>("[data-tempo]");
  const tempoLabel = $("[data-tempo-label]");
  const metroBtn = $<HTMLButtonElement>("[data-stage] [data-metro]");
  const liveMetroBtn = $<HTMLButtonElement>("[data-live-metro]");
  const backBtn = $<HTMLButtonElement>("[data-back]");
  const nextBtn = $<HTMLButtonElement>("[data-next]");
  const eyebrow = $("[data-eyebrow]");
  const soundBtn = $<HTMLButtonElement>("[data-sound]");

  const renderSound = (): void => {
    const on = synth.isEnabled();
    soundBtn.classList.toggle("active", on);
    soundBtn.textContent = on ? (synth.isReady() ? "Sound on" : "Loading piano…") : "Sound off";
  };
  synth.onStatus(() => renderSound());
  renderSound();
  if (synth.isEnabled()) void synth.warm();
  soundBtn.addEventListener("click", () => {
    synth.setEnabled(!synth.isEnabled());
    localStorage.setItem("piano-coach-sound", synth.isEnabled() ? "on" : "off");
    renderSound();
  });
  const pieceSelect = $<HTMLSelectElement>("[data-piece-select]");
  const livePlay = $<HTMLButtonElement>("[data-live-play]");
  const liveTitle = $("[data-live-title]");
  const importStatus = $("[data-import-status]");
  const importInput = $<HTMLInputElement>("[data-import]");
  const importBox = $<HTMLElement>("[data-import-box]");
  const importProgress = $<HTMLElement>("[data-import-progress]");
  const importBar = $<HTMLElement>("[data-import-bar]");
  const importOverlay = $<HTMLElement>("[data-import-overlay]");
  const importFileName = $("[data-import-file-name]");
  const importStepsList = $<HTMLElement>("[data-import-steps]");
  const importStepDetail = $("[data-import-step-detail]");
  const importOverlayBar = $<HTMLElement>("[data-import-overlay-bar]");
  const importDismiss = $<HTMLButtonElement>("[data-import-dismiss]");
  let importOverlayTimer = 0;
  let importPulseTimer = 0;
  let importStartedAt = 0;

  const formatImportElapsed = (ms: number): string => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };
  let importOverlayOpen = false;
  importStepsList.innerHTML = IMPORT_STEPS.map(
    (step, index) =>
      `<li class="import-step pending" data-import-step="${step.id}"><span class="step-mark">${index + 1}</span><span class="step-label">${step.label}</span></li>`,
  ).join("");
  const tileModeSelect = $<HTMLSelectElement>("[data-tile-mode]");
  tileModeSelect.value = normalizeTileMode(localStorage.getItem("piano-coach-tile-mode") ?? "voice");
  const songLevelSelect = $<HTMLSelectElement>("[data-song-level]");
  songLevelSelect.value = normalizeSongLevel(localStorage.getItem("piano-coach-song-level") ?? "easy");
  const songKeySelect = $<HTMLSelectElement>("[data-song-key]");
  songKeySelect.innerHTML = KEY_TONIC_OPTIONS.map(
    (opt) => `<option value="${opt.value}">${opt.label}</option>`,
  ).join("");
  songKeySelect.value = localStorage.getItem("piano-coach-song-key") ?? "auto";
  const songModeSelect = $<HTMLSelectElement>("[data-song-mode]");
  songModeSelect.value = localStorage.getItem("piano-coach-song-mode") ?? "auto";

  const songKeyPreference = () =>
    normalizeKeyPreference(songKeySelect.value, songModeSelect.value);

  const playbackLayers = (piece: Piece) => {
    const full =
      piece.fullNotes ??
      [...(piece.instNotes ?? []), ...(piece.voiceNotes ?? [])].sort(
        (a, b) => a.start - b.start || a.note - b.note,
      );
    return {
      voice: piece.voiceNotes,
      instruments: piece.instNotes,
      leftHand: piece.leftHandNotes,
      rightHand: piece.rightHandNotes,
      all: full.length ? full : piece.notes,
    };
  };

  const playbackMode = (_piece: Piece): ReturnType<typeof normalizeTileMode> => {
    const level = normalizeSongLevel(songLevelSelect.value);
    if (level === "easy") return "voice";
    if (level === "hard") {
      const chosen = normalizeTileMode(tileModeSelect.value);
      return chosen === "voice" ? "both" : chosen;
    }
    return "both";
  };

  const rawNotesForPiece = (piece: Piece): TimedNote[] => {
    const level = normalizeSongLevel(songLevelSelect.value);
    const layers = playbackLayers(piece);
    if (level === "easy" || level === "medium") {
      return sourceNotesForLevel(layers, level, piece.notes);
    }
    const source = applyTileMode(layers, playbackMode(piece));
    return source.length ? source : piece.notes;
  };
  const viewTabs = $<HTMLElement>("[data-view-tabs]");
  const playTransport = $<HTMLElement>("[data-play-transport]");
  const liveStats = host.querySelector(".live-stats") as HTMLElement;
  const exportBtn = $<HTMLButtonElement>("[data-export]");
  const exportXmlBtn = $<HTMLButtonElement>("[data-export-xml]");
  const transcribeTargetSelect = $<HTMLSelectElement>("[data-transcribe-target]");
  const removeBtn = $<HTMLButtonElement>("[data-library-remove]");
  const retranscribeBtn = $<HTMLButtonElement>("[data-retranscribe]");
  const playStage = $<HTMLElement>("[data-play-stage]");
  const sheetWindow = $<HTMLElement>("[data-sheet-window]");
  const showSheet = $<HTMLInputElement>("[data-show-sheet]");
  const songMeta = $("[data-song-meta]");
  const sidebarRecents = $<HTMLElement>("[data-sidebar-recents]");
  const settingsPanel = $<HTMLElement>("[data-settings-panel]");
  const settingsToggle = $<HTMLButtonElement>("[data-settings-toggle]");
  const newImportBtn = $<HTMLButtonElement>("[data-new-import]");
  const importSecondary = $<HTMLInputElement>("[data-import-secondary]");
  const hearSongToggle = $<HTMLInputElement>("[data-hear-song]");
  const hearSongTransport = $<HTMLInputElement>("[data-hear-song-transport]");
  const hearNotesTransport = $<HTMLInputElement>("[data-hear-notes-transport]");
  const appRoot = host.querySelector(".app");
  const mountPiano = (where: "live" | "course"): void => {
    if (where === "live") {
      keyboardStack?.append(piano.root);
      coursePracticeDock.classList.add("hidden");
    } else {
      courseKeysHost.append(piano.root);
      coursePracticeDock.classList.remove("hidden");
    }
    roll.invalidateLayout();
    piano.invalidateLayout();
  };

  const showKeys = (on: boolean, mount: "live" | "course" = "course"): void => {
    appRoot?.classList.toggle("keys-on", on);
    if (!on) {
      coursePracticeDock.classList.add("hidden");
      courseRollHost.classList.add("hidden");
      workspace?.classList.add("hidden");
      return;
    }
    if (mount === "live") {
      workspace?.classList.remove("hidden");
      mountPiano("live");
    } else {
      workspace?.classList.add("hidden");
      mountPiano("course");
    }
  };

  const formatAdded = (ms?: number): string => {
    if (!ms) return "Imported";
    return `Added ${new Date(ms).toLocaleDateString()}`;
  };

  const pieceMeta = (piece: Piece): string => {
    const notes = piece.fullNotes ?? piece.notes;
    const type =
      piece.source === "audio" ? "MP3" : piece.source === "musicxml" ? "MusicXML" : "MIDI";
    const duration = formatTime(pieceDuration(notes, piece.audio, piece.audioOffset));
    return `${type} · ${notes.length} notes · ${duration} · ${formatAdded(piece.savedAt)}`;
  };

  const exportPieceMidi = (piece: Piece): void => {
    const blob = new Blob([writeMidi(piece.fullNotes ?? piece.notes, piece.title)], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${piece.title.replace(/\s+/g, "-").toLowerCase()}.mid`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPieceMusicXml = (piece: Piece): void => {
    const xml = writeMusicXml(piece.fullNotes ?? piece.notes, piece.title);
    const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${piece.title.replace(/\s+/g, "-").toLowerCase()}.musicxml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const playLibraryPiece = (id: string): void => {
    if (!saved.some((piece) => piece.id === id)) return;
    localStorage.setItem("piano-coach-last-piece", id);
    playView = "play";
    if (mode === "live") {
      fillPieces(id);
      pieceSelect.value = id;
      stopLiveLoop();
      loadSelectedPiece();
      syncPlayView();
      renderLiveHud();
      return;
    }
    setMode("live", { pieceId: id });
  };

  const renderSidebarRecents = (): void => {
    const recent = saved.slice(0, 10);
    if (recent.length === 0) {
      sidebarRecents.innerHTML = `<p class="ss-recents-empty">Import a song to see it here.</p>`;
      return;
    }
    sidebarRecents.innerHTML = recent
      .map(
        (piece) =>
          `<button type="button" class="ss-recent-item" data-recent-id="${escapeHtml(piece.id)}">${escapeHtml(piece.title)}</button>`,
      )
      .join("");
  };

  const renderLibrary = (): void => {
    renderSidebarRecents();
    libraryEmptyBtn.hidden = saved.length === 0;
    if (saved.length === 0) {
      libraryList.innerHTML = `<p class="library-empty">No songs yet. Drop an MP3 or MIDI file above to add one.</p>`;
      if (!libraryStatus.textContent?.includes("Converted") && !libraryStatus.textContent?.includes("Saved")) {
        libraryStatus.textContent = "Nothing imported yet.";
      }
      return;
    }
    libraryList.innerHTML = saved
      .map(
        (piece) => `
        <article class="library-item" data-library-item="${escapeHtml(piece.id)}">
          <div class="library-item-main">
            <h3>${escapeHtml(piece.title)}</h3>
            <p class="library-meta">${escapeHtml(pieceMeta(piece))}${piece.audio ? " · with audio" : ""}</p>
          </div>
          <div class="library-actions">
            <button type="button" class="primary" data-library-play>Play</button>
            <button type="button" class="ghost" data-library-rename>Rename</button>
            ${piece.source === "audio" ? `<button type="button" class="ghost" data-library-retranscribe>Re-transcribe</button>` : ""}
            <button type="button" class="ghost" data-library-export>MIDI</button>
            <button type="button" class="ghost danger" data-library-delete>Delete</button>
          </div>
        </article>`,
      )
      .join("");
  };

  const fillPieces = (selected?: string): void => {
    if (saved.length === 0) {
      pieceSelect.innerHTML = `<option value="">No songs yet</option>`;
      pieceSelect.disabled = true;
      return;
    }
    pieceSelect.disabled = false;
    pieceSelect.innerHTML = saved
      .map((piece) => `<option value="${escapeHtml(piece.id)}">${escapeHtml(piece.title)}</option>`)
      .join("");
    const pick = selected ?? localStorage.getItem("piano-coach-last-piece") ?? saved[0]?.id ?? "";
    if (pick && saved.some((piece) => piece.id === pick)) pieceSelect.value = pick;
  };

  const syncSheetLayout = (): void => {
    const liveOn = mode === "live";
    const show = showSheet.checked;
    sheetWindow.hidden = !liveOn || !show;
    playStage?.classList.toggle("sheet-off", liveOn && !show);
  };

  const currentPiece = (): Piece => {
    if (saved.length === 0) {
      return { id: "", title: "Import a song", source: "audio", notes: [] };
    }
    return saved.find((piece) => piece.id === pieceSelect.value) ?? saved[0]!;
  };

  const applyHearSettings = (): void => {
    const hearNotes = $<HTMLInputElement>("[data-hear-notes]");
    live.setHearSong(hearSongToggle.checked);
    live.setHearNotes(hearNotes.checked);
    hearSongTransport.checked = hearSongToggle.checked;
    hearNotesTransport.checked = hearNotes.checked;
  };

  const courseLevelsVisible = (): LevelDef[] =>
    LEVELS.filter((level) => !level.useLibrarySong || saved.length > 0);

  const courseUnitsVisible = (): string[] =>
    UNITS.filter((unit) => courseLevelsVisible().some((level) => level.unit === unit));

  const courseTrainingPiece = (): Piece | null => {
    if (saved.length === 0) return null;
    const id = localStorage.getItem(COURSE_PIECE_KEY);
    return saved.find((piece) => piece.id === id) ?? saved[0] ?? null;
  };

  const courseTrainingNotes = (piece: Piece, songLevel: SongLevel): TimedNote[] => {
    const raw = sourceNotesForLevel(
      {
        voice: piece.voiceNotes,
        instruments: piece.instNotes,
        leftHand: piece.leftHandNotes,
        rightHand: piece.rightHandNotes,
        all: piece.fullNotes ?? piece.notes,
      },
      songLevel,
      piece.notes,
    );
    let notes = applySongLevel(raw, songLevel, { tonic: "auto", mode: "auto" });
    if (songLevel === "hard") {
      notes = refineNoteDurations(polishHardChords(notes));
    } else {
      notes = refineNoteDurations(limitExtremeFlood(fixSemitoneSlips(notes)));
    }
    return notes;
  };

  const courseNotesForLevel = (level: LevelDef): TimedNote[] | undefined => {
    if (!level.useLibrarySong) return undefined;
    const piece = courseTrainingPiece();
    if (!piece) return undefined;
    const songLevel = level.librarySongLevel ?? "easy";
    const notes = courseTrainingNotes(piece, songLevel);
    if (level.kind === "play") return levelTimedNotes(level, notes);
    return notes;
  };

  const applyCoursePlayAudio = (libraryPiece: Piece | null): void => {
    const hasAudio = Boolean(libraryPiece?.audio);
    courseHearSongToggle.disabled = !hasAudio;
    courseHearSongToggle.checked = hasAudio;
    courseHearNotesToggle.checked = !hasAudio;
    live.setHearSong(hasAudio);
    live.setHearNotes(!hasAudio);
    courseAudioToggles.classList.remove("hidden");
  };

  const startCourseLevel = (id: string): void => {
    const level = LEVELS.find((item) => item.id === id);
    if (!level) return;
    const courseNotes = courseNotesForLevel(level);
    if (level.useLibrarySong && !courseNotes?.length) {
      renderLearn(lessons.openPath());
      setImportMessage("Import a song on Play, then pick it under Training song on the course path.");
      return;
    }
    renderLearn(lessons.startLevel(id, courseNotes ? { courseNotes } : undefined));
  };

  const startCourseContinue = (): void => {
    const records = lessons.snapshot().records;
    const levels = courseLevelsVisible();
    startCourseLevel(nextIncompleteId(records, levels));
  };

  courseHearSongToggle.addEventListener("change", () => {
    live.setHearSong(courseHearSongToggle.checked);
    if (courseHearSongToggle.checked) {
      courseHearNotesToggle.checked = false;
      live.setHearNotes(false);
    }
  });
  courseHearNotesToggle.addEventListener("change", () => {
    live.setHearNotes(courseHearNotesToggle.checked);
    if (courseHearNotesToggle.checked && courseHearSongToggle.checked) {
      courseHearSongToggle.checked = false;
      live.setHearSong(false);
    }
  });

  const playableNotes = (piece: Piece) => {
    const level = normalizeSongLevel(songLevelSelect.value);
    const raw = rawNotesForPiece(piece);
    const pref = songKeyPreference();
    let notes = applySongLevel(raw, level, pref);
    if (level === "hard") {
      notes = refineNoteDurations(polishHardChords(notes));
    } else {
      notes = refineNoteDurations(limitExtremeFlood(fixSemitoneSlips(notes)));
    }
    return notes;
  };

  const loadSelectedPiece = (): void => {
    if (saved.length === 0) {
      live.load("Import a song", [], undefined);
      liveTitle.textContent = "Import a song";
      songMeta.textContent = "Drop an MP3 or MIDI file to get started.";
      removeBtn.classList.add("hidden");
      retranscribeBtn.classList.add("hidden");
      exportBtn.classList.add("hidden");
      exportXmlBtn.classList.add("hidden");
      tileModeSelect.disabled = true;
      hearSongToggle.disabled = true;
      hearSongTransport.disabled = true;
      score.render([]);
      score.setTime(-1);
      syncPlayView();
      return;
    }
    const piece = currentPiece();
    const notes = playableNotes(piece);
    live.load(piece.title, notes, piece.audio, piece.audioOffset, piece.audioDurationSec);
    const level = normalizeSongLevel(songLevelSelect.value);
    tileModeSelect.disabled =
      level !== "hard" ||
      !(piece.voiceNotes?.length || piece.instNotes?.length || piece.leftHandNotes?.length || piece.fullNotes?.length);
    const canExport = piece.source !== "builtin";
    exportBtn.classList.toggle("hidden", !canExport);
    exportXmlBtn.classList.toggle("hidden", !canExport);
    syncPlayView();
    piano.fitNotes(notes.map((note) => note.note));
    hearSongToggle.disabled = !piece.audio;
    hearSongTransport.disabled = !piece.audio;
    if (!piece.audio) {
      hearSongToggle.checked = false;
      hearSongTransport.checked = false;
    }
    applyHearSettings();
    liveTitle.textContent = piece.title;
    const levelLabel =
      level === "easy"
        ? "Easy · vocals only"
        : level === "hard"
          ? "Hard · full chords"
          : "Medium · vocals + chords";
    const pref = songKeyPreference();
    const keyLabel = resolveSongKey(rawNotesForPiece(piece), pref).label;
    songMeta.textContent = `${levelLabel} · ${keyLabel} · ${pieceMeta(piece)}`;
    removeBtn.classList.toggle("hidden", piece.source === "builtin");
    retranscribeBtn.classList.toggle("hidden", piece.source !== "audio");
    localStorage.setItem("piano-coach-last-piece", piece.id);
    const first = notes[0];
    if (first) piano.focusNote(first.note);
    score.render(notes);
    score.setTime(-1);
  };

  const applyWaitForPlayer = (): void => {
    const waitToggle = $<HTMLInputElement>("[data-wait-for-me]");
    const selected = midi.selectedInput();
    waitToggle.disabled = !selected;
    waitToggle.closest("label")?.classList.toggle("disabled", !selected);
    live.setWaitForPlayer(Boolean(selected && waitToggle.checked));
  };

  const renderDevices = (): void => {
    const devices = midi.listInputs();
    const selected = midi.selectedInput();
    deviceSelect.innerHTML = devices
      .map((device) => `<option value="${device.id}">${device.name}</option>`)
      .join("");
    if (selected) deviceSelect.value = selected.id;
    devicePick.classList.toggle("hidden", devices.length === 0);
    midiStatus.classList.toggle("live", Boolean(selected));
    midiLabel.textContent = selected ? selected.name : "Keyboard not connected";
    applyWaitForPlayer();
  };

  const renderPathList = (
    target: HTMLElement,
    heading: string,
    units: string[],
    levels: { id: string; unit: string; title: string; skill: string; hand?: string }[],
    records: LessonSnapshot["records"],
    continueId: string,
    onContinue: () => void,
    onLevel: (id: string) => void,
  ): void => {
    const cleared = clearedCount(records, levels);
    const next = levels.find((level) => level.id === continueId);
    const game = loadGame();
    const pct = Math.round((cleared / Math.max(1, levels.length)) * 100);
    const tones = ["forest", "ocean", "grape", "ember", "mint", "dusk", "maple", "gold"];
    const lanes = [1, 2, 2, 1, 0, 0];
    target.classList.add("trail-card");
    target.innerHTML = `
      <div class="game-bar">
        <div class="game-stat flame ${game.streak > 0 ? "hot" : ""}">
          <span aria-hidden="true">🔥</span>
          <strong>${game.streak}</strong>
          <em>day streak</em>
        </div>
        <div class="game-stat xp">
          <span aria-hidden="true">⚡</span>
          <strong>${game.xp}</strong>
          <em>XP</em>
        </div>
        <div class="game-stat">
          <strong>${cleared}/${levels.length}</strong>
          <em>cleared</em>
        </div>
      </div>
      <div class="xp-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <i style="width:${pct}%"></i>
      </div>
      <div class="path-head">
        <div>
          <h2>${heading}</h2>
          <p>${cleared === levels.length ? "Path complete — tap any node to replay." : "Follow the path. Clear a node to unlock the next."}</p>
        </div>
      </div>
      ${heading === "Piano course" && saved.length > 0 ? `
        <div class="course-import-bar">
          <label>Training song
            <select data-course-piece-select>
              ${saved
                .map(
                  (piece) =>
                    `<option value="${escapeHtml(piece.id)}"${courseTrainingPiece()?.id === piece.id ? " selected" : ""}>${escapeHtml(piece.title)}</option>`,
                )
                .join("")}
            </select>
          </label>
          <p class="hint">Your imports unit — Easy vocals → Medium chords → Hard full song. Original audio when available.</p>
        </div>
      ` : ""}
      ${units
        .map((unit, unitIndex) => {
          const unitLevels = levels.filter((level) => level.unit === unit);
          const unitCleared = unitLevels.every((level) => (records[level.id]?.stars ?? 0) >= 1);
          const blurb = UNIT_BLURBS[unit] ?? READING_UNIT_BLURBS[unit] ?? "";
          const tone = tones[unitIndex % tones.length];
          return `
            <section class="trail-unit">
              <div class="unit-banner tone-${tone}">
                <p>Unit ${unitIndex + 1}</p>
                <h3>${escapeHtml(unit)}</h3>
                ${blurb ? `<p class="unit-blurb">${escapeHtml(blurb)}</p>` : ""}
              </div>
              <div class="trail">
                ${unitLevels
                  .map((level, step) => {
                    const unlocked = isUnlocked(level.id, records, levels);
                    const stars = records[level.id]?.stars ?? 0;
                    const done = stars >= 1;
                    const current = cleared < levels.length && level.id === continueId;
                    const number = levels.indexOf(level) + 1;
                    const lane = lanes[step % lanes.length];
                    const tag = handShort(level.hand);
                    const icon = !unlocked ? "🔒" : done ? (stars >= 3 ? "★" : "✓") : "♪";
                    const state = !unlocked ? "locked" : current ? "current" : done ? "done" : "open";
                    return `
                      <div class="trail-node lane-${lane} ${state}" data-lane="${lane}">
                        ${current ? `
                          <div class="node-pop">
                            <em>${tag ? `${tag} · ` : ""}${escapeHtml(level.skill)}</em>
                            <strong>${escapeHtml(level.title)}</strong>
                            <button type="button" class="primary" data-continue-node="${level.id}">
                              ${done ? "Replay" : next && next.id === level.id && cleared > 0 ? "Continue" : "Start"}
                            </button>
                          </div>
                        ` : ""}
                        <button type="button" class="node" data-level="${level.id}" ${unlocked ? "" : "disabled"} aria-label="${escapeHtml(level.title)}">
                          <span>${icon}</span>
                          <small>${number}</small>
                        </button>
                        <p class="node-stars">${done ? starText(stars) : unlocked ? "•••" : ""}</p>
                      </div>
                    `;
                  })
                  .join("")}
                <div class="trail-node lane-1 chest ${unitCleared ? "open" : "shut"}">
                  <div class="node chest-node" aria-hidden="true"><span>${unitCleared ? "🏆" : "🎁"}</span></div>
                  <p class="node-stars">${unitCleared ? "Unit clear" : "Clear the unit"}</p>
                </div>
              </div>
            </section>
          `;
        })
        .join("")}
    `;
    target.querySelector<HTMLSelectElement>("[data-course-piece-select]")?.addEventListener("change", (event) => {
      const select = event.target as HTMLSelectElement;
      localStorage.setItem(COURSE_PIECE_KEY, select.value);
    });
    target.querySelector("[data-continue]")?.addEventListener("click", onContinue);
    target.querySelectorAll<HTMLButtonElement>("[data-continue-node]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.continueNode;
        if (id) onLevel(id);
      });
    });
    target.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.level;
        if (id) onLevel(id);
      });
    });
    window.requestAnimationFrame(() => {
      target.querySelector(".trail-node.current")?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const staffNotesFor = (state: ReadingSnapshot): StaffNote[] => {
    if (!state.level) return [];
    if (state.level.kind === "find") {
      const note = state.expected[0] ?? state.sequence[0];
      return note === undefined ? [] : [{ midi: note, state: "now" }];
    }
    const start = Math.max(0, state.index - 1);
    return state.sequence.slice(start, start + 8).map((midi, offset) => ({
      midi,
      state: start + offset < state.index ? "done" : start + offset === state.index ? "now" : "idle",
    }));
  };

  let coursePlayActive = false;
  let coursePlayRaf = 0;

  const stopCoursePlay = (): void => {
    if (coursePlayRaf) cancelAnimationFrame(coursePlayRaf);
    coursePlayRaf = 0;
    if (!coursePlayActive && !courseRollHost.contains(roll.canvas)) return;
    coursePlayActive = false;
    live.stop();
    rollHost?.append(roll.canvas);
    courseRollHost.classList.add("hidden");
    courseAudioToggles.classList.add("hidden");
    appRoot?.classList.remove("course-play-on");
    piano.clearHighlights();
  };

  const renderCoursePlayHud = (): void => {
    const snap = live.snapshot();
    progressEl.textContent = String(snap.hits);
    progressLabel.textContent = "hits";
    wrongEl.textContent = String(snap.misses);
    streakEl.textContent = String(snap.combo);
    promptEl.textContent = snap.finished
      ? "Song complete — nice work."
      : snap.waiting
        ? "Your turn — play the glowing keys"
        : snap.playing
          ? "Follow the falling notes"
          : "Press Restart to try again";
    roll.draw(snap.notes, snap.time, snap.judged);
    const glowing = snap.waiting ? snap.dueNotes : live.activeTilePitches(snap.time);
    if (snap.playing || snap.time > -0.05) piano.lightTargets(glowing);
    else piano.clearHighlights();
  };

  const loopCoursePlay = (): void => {
    if (!coursePlayActive) return;
    live.tickWait();
    live.tickGuide();
    renderCoursePlayHud();
    const snap = live.snapshot();
    if (snap.finished) {
      stopCoursePlay();
      renderLearn(lessons.finishPlay(snap.hits, snap.misses));
      return;
    }
    if (live.playingNow()) coursePlayRaf = requestAnimationFrame(loopCoursePlay);
  };

  const startCoursePlay = (state: LessonSnapshot): void => {
    const level = state.level;
    if (!level || level.kind !== "play" || state.complete) return;
    stopCoursePlay();
    coursePlayActive = true;
    courseRollHost.classList.remove("hidden");
    courseRollHost.append(roll.canvas);
    const libraryPiece = level.useLibrarySong ? courseTrainingPiece() : null;
    const trainingNotes = libraryPiece
      ? courseTrainingNotes(libraryPiece, level.librarySongLevel ?? "easy")
      : undefined;
    const notes = levelTimedNotes(level, trainingNotes);
    if (notes.length === 0) return;
    live.setWaitForPlayer(true);
    applyCoursePlayAudio(libraryPiece);
    live.load(
      libraryPiece?.title ?? level.title,
      notes,
      libraryPiece?.audio,
      libraryPiece?.audioOffset,
      libraryPiece?.audioDurationSec,
    );
    piano.fitNotes(notes.map((note) => note.note));
    if (state.showHint && notes.length) piano.revealTargets([...new Set(notes.map((note) => note.note))]);
    live.play();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        renderCoursePlayHud();
        loopCoursePlay();
      });
    });
  };

  const renderLearn = (state: LessonSnapshot): void => {
    const onPath = state.screen === "path";
    const inLesson = state.screen === "lesson";
    pathEl.hidden = !onPath;
    stageEl.hidden = onPath;
    staffHost.hidden = true;
    bigNote.classList.remove("hidden");
    backBtn.classList.toggle("hidden", !inLesson);
    nextBtn.classList.toggle("hidden", !(inLesson && state.complete && state.levelNumber < state.levelTotal));
    teachBlock.classList.toggle("hidden", !inLesson || !state.teach);
    teachEl.textContent = state.teach;
    eyebrow.textContent = inLesson ? `Level ${state.levelNumber} of ${state.levelTotal}` : "Piano course";

    const handName = handLabel(state.hand);
    handEl.hidden = !inLesson || !handName;
    handEl.textContent = handName;
    courseEl.hidden = !inLesson || state.course.length === 0;
    courseEl.innerHTML = state.course.map((para) => `<p>${escapeHtml(para)}</p>`).join("");
    fingersEl.hidden = !inLesson || !state.fingers;
    fingersEl.textContent = state.fingers;
    winEl.classList.toggle("hidden", !inLesson || !state.complete);
    winTitle.textContent = state.stars >= 3 ? "Perfect!" : state.stars === 2 ? "Nice!" : "Lesson clear";
    winXp.textContent = state.xpEarned ? `+${state.xpEarned} XP` : "";
    showKeys(inLesson || state.screen === "free", "course");
    appRoot?.classList.toggle("course-play-on", inLesson && state.playMode && !state.complete);

    if (onPath) {
      stopCoursePlay();
      renderPathList(
        pathEl,
        "Piano course",
        courseUnitsVisible(),
        courseLevelsVisible(),
        state.records,
        state.continueId,
        () => startCourseContinue(),
        (id) => startCourseLevel(id),
      );
      piano.clearHighlights();
      sequenceStrip.hidden = true;
      return;
    }

    titleEl.textContent = state.title;
    skillEl.textContent = state.skill;
    promptEl.textContent = state.prompt;
    const shown = state.level?.kind === "hold" && state.level.bass !== undefined
      ? state.expected
      : state.expected;
    const inPlayLesson = inLesson && state.playMode && !state.complete;
    bigNote.classList.toggle("hidden", inPlayLesson);
    bigNote.textContent = state.complete
      ? starText(state.stars)
      : state.screen === "free"
        ? "Play"
        : shown.length === 0
          ? "—"
          : shown.length > 1
            ? prettyChord(shown)
            : prettyName(shown[0] ?? 60);
    if (!inPlayLesson) {
      progressEl.textContent = inLesson ? `${Math.min(state.correct, state.goal)}/${state.goal}` : String(state.correct);
      progressLabel.textContent = inLesson ? "cleared" : "notes";
    }
    streakEl.textContent = String(state.streak);
    wrongEl.textContent = String(state.wrong);
    flash.dataset.result = state.lastResult;

    const targets = state.level?.kind === "hold" && state.level.bass !== undefined
      ? [state.level.bass, ...state.expected]
      : state.expected;
    piano.clearHighlights();
    if (targets.length) piano.focusSpan(targets);
    if (state.showHint && targets.length) piano.revealTargets(targets);

    if (inPlayLesson) {
      sequenceStrip.hidden = true;
      sequenceStrip.innerHTML = "";
      if (!coursePlayActive) startCoursePlay(state);
      return;
    }

    stopCoursePlay();

    if (!inLesson || (state.level?.kind !== "sequence" && state.level?.kind !== "hold") || state.sequence.length === 0) {
      sequenceStrip.hidden = true;
      sequenceStrip.innerHTML = "";
      return;
    }
    sequenceStrip.hidden = false;
    sequenceStrip.innerHTML = state.sequence
      .map((step, index) => {
        const cls = index < state.index ? "done" : index === state.index ? "now" : "";
        const label = step.length > 1 ? prettyChord(step) : prettyName(step[0] ?? 60);
        return `<span class="${cls}">${escapeHtml(label)}</span>`;
      })
      .join("");
  };

  const renderRead = (state: ReadingSnapshot): void => {
    const onPath = state.screen === "path";
    const inLesson = state.screen === "lesson";
    pathEl.hidden = !onPath;
    stageEl.hidden = onPath;
    staffHost.hidden = onPath;
    bigNote.classList.toggle("hidden", inLesson && !state.showName && !state.complete);
    backBtn.classList.toggle("hidden", !inLesson);
    nextBtn.classList.toggle("hidden", !(inLesson && state.complete && state.levelNumber < state.levelTotal));
    teachBlock.classList.toggle("hidden", !inLesson || !state.teach);
    teachEl.textContent = state.teach;
    eyebrow.textContent = inLesson ? `Reading ${state.levelNumber} of ${state.levelTotal}` : "Read music";
    sequenceStrip.hidden = true;
    handEl.hidden = !inLesson;
    handEl.textContent = state.level?.clef === "bass" ? "Bass · left hand" : inLesson ? "Treble · right hand" : "";
    courseEl.hidden = !inLesson || state.course.length === 0;
    courseEl.innerHTML = state.course.map((para) => `<p>${escapeHtml(para)}</p>`).join("");
    fingersEl.hidden = true;
    winEl.classList.toggle("hidden", !inLesson || !state.complete);
    winTitle.textContent = state.stars >= 3 ? "Perfect!" : state.stars === 2 ? "Nice!" : "Lesson clear";
    winXp.textContent = state.xpEarned ? `+${state.xpEarned} XP` : "";
    showKeys(inLesson, "course");

    if (onPath) {
      renderPathList(pathEl, "Read music", READING_UNITS, READING_LEVELS, state.records, state.continueId, () => renderRead(reading.startContinue()), (id) => renderRead(reading.startLevel(id)));
      piano.clearHighlights();
      return;
    }

    titleEl.textContent = state.title;
    skillEl.textContent = state.skill;
    promptEl.textContent = state.prompt;
    bigNote.textContent = state.complete ? starText(state.stars) : state.showName && state.expected[0] !== undefined ? prettyName(state.expected[0]) : " ";
    progressEl.textContent = `${Math.min(state.correct, state.goal)}/${state.goal}`;
    progressLabel.textContent = "cleared";
    streakEl.textContent = String(state.streak);
    wrongEl.textContent = String(state.wrong);
    flash.dataset.result = state.lastResult;
    renderStaff(staffHost, staffNotesFor(state), { clef: state.level?.clef, showName: false });

    piano.clearHighlights();
    if (state.showHint && state.expected.length) {
      piano.revealTargets(state.expected);
      const target = state.expected[0];
      if (target !== undefined) piano.focusNote(target);
    } else if (state.expected[0] !== undefined) {
      piano.focusNote(state.expected[0]);
    }
  };

  let hudAt = 0;
  const hitsEl = $("[data-live-hits]");
  const comboEl = $("[data-live-combo]");
  const missEl = $("[data-live-miss]");
  const timeEl = $("[data-live-time]");
  const liveSeek = $<HTMLInputElement>("[data-live-seek]");
  const SEEK_JUMP = 5;
  let seekDragging = false;
  const sheetToggle = showSheet;
  type PlayView = "review" | "play";
  let playView: PlayView = "play";

  const canReviewPiece = (piece: Piece): boolean =>
    piece.source === "audio" || piece.source === "midi" || piece.source === "musicxml";

  const persistEditedNotes = (edited: TimedNote[]): void => {
    const piece = currentPiece();
    if (!canReviewPiece(piece)) return;
    const level = normalizeSongLevel(songLevelSelect.value);
    const updated = applyEditedNotesForLevel(piece, level, edited);
    const idx = saved.findIndex((item) => item.id === updated.id);
    if (idx >= 0) saved[idx] = updated;
    void saveLibraryPiece(updated);
    const notes = playableNotes(updated);
    live.load(updated.title, notes, updated.audio, updated.audioOffset, updated.audioDurationSec);
    noteEditor.markClean();
  };

  const refreshReviewEditor = (): void => {
    const piece = currentPiece();
    const level = normalizeSongLevel(songLevelSelect.value);
    const raw = getEditableNotesForLevel(piece, level);
    const span = pieceDuration(raw, piece.audio, piece.audioOffset, piece.audioDurationSec);
    noteEditor.load(raw, span, piece.audio, piece.audioOffset, {
      left: piece.leftHandNotes,
      right: piece.rightHandNotes,
      voice: piece.voiceNotes,
    });
  };

  const syncPlayView = (): void => {
    const piece = currentPiece();
    const canEdit = canReviewPiece(piece) && saved.length > 0;
    const reviewing = canEdit && playView === "review";
    viewTabs.classList.toggle("hidden", !canEdit);
    host.querySelectorAll<HTMLButtonElement>("[data-play-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.playView === playView);
    });
    noteEditor.root.classList.toggle("hidden", !reviewing);
    playMain?.classList.toggle("review-mode", reviewing);
    playStageEl?.classList.toggle("review-mode", reviewing);
    rollHost && ((rollHost as HTMLElement).hidden = reviewing);
    roll.canvas.classList.toggle("hidden", reviewing);
    keyboardStack?.classList.toggle("hidden", reviewing);
    playTransport.classList.toggle("hidden", reviewing);
    liveStats?.classList.toggle("hidden", reviewing);
    appRoot?.classList.toggle("review-on", reviewing);
  };

  const setPlayView = (view: PlayView): void => {
    playView = view;
    stopLiveLoop();
    syncPlayView();
    if (view === "review" && canReviewPiece(currentPiece())) {
      loadSelectedPiece();
      refreshReviewEditor();
      noteEditor.focus();
    } else {
      loadSelectedPiece();
      renderLiveHud();
    }
  };

  const seekSong = (time: number): void => {
    const snap = live.snapshot();
    const clamped = Math.max(-COUNT_IN, Math.min(snap.duration, time));
    const wasPlaying = live.playingNow();
    live.seek(clamped);
    liveSeek.max = String(Math.max(0.01, snap.duration));
    liveSeek.value = String(Math.max(0, clamped));
    if (wasPlaying) loopLive();
    else renderLiveHud();
  };

  const skipSong = (delta: number): void => {
    seekSong(live.snapshot().time + delta);
  };

  const skipToNote = (direction: -1 | 1): void => {
    const snap = live.snapshot();
    const t = Math.max(0, snap.time);
    const onsets = [...new Set(snap.notes.map((n) => n.start))].sort((a, b) => a - b);
    if (direction < 0) {
      const prev = onsets.filter((s) => s < t - 0.05).at(-1);
      seekSong(prev ?? 0);
      return;
    }
    const next = onsets.find((s) => s > t + 0.05);
    seekSong(next ?? snap.duration);
  };

  roll.setSeekHandler((time) => seekSong(time));

  noteEditor.onNotesChange((notes) => persistEditedNotes(notes));
  noteEditor.onSeekRequest((time) => seekSong(time));
  noteEditor.onPlayRequest(() => {
    applyHearSettings();
    live.toggle();
    if (live.playingNow()) loopLive();
    else renderLiveHud();
  });

  const renderLiveHud = (): void => {
    const snap = live.snapshot();
    if (playView === "review" && canReviewPiece(currentPiece())) {
      noteEditor.setPlayhead(Math.max(0, snap.time), snap.playing);
      if (sheetToggle.checked) score.setTime(snap.time);
      return;
    }
    roll.draw(snap.notes, snap.time, snap.judged);
    if (sheetToggle.checked) score.setTime(snap.time);
    const glowing = snap.waiting ? snap.dueNotes : live.activeTilePitches(snap.time);
    if (snap.playing || snap.time > -0.05) piano.lightTargets(glowing);
    else piano.clearHighlights();
    const now = performance.now();
    if (now - hudAt < 120 && snap.playing) return;
    hudAt = now;
    liveTitle.textContent = snap.finished
      ? `${snap.title} · done`
      : snap.waiting
        ? `${snap.title} · your turn`
        : snap.title;
    hitsEl.textContent = String(snap.hits);
    comboEl.textContent = String(snap.combo);
    missEl.textContent = String(snap.misses);
    timeEl.textContent = `${formatTime(Math.max(0, snap.time))} / ${formatTime(snap.duration)}`;
    liveSeek.max = String(Math.max(0.01, snap.duration));
    if (!seekDragging) liveSeek.value = String(Math.max(0, snap.time));
    livePlay.textContent = snap.playing ? "Pause" : snap.finished ? "Replay" : "Play";
  };

  const stopLiveLoop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    live.stop();
    livePlay.textContent = "Play";
    piano.clearHighlights();
  };

  const loopLive = (): void => {
    live.tickWait();
    live.tickGuide();
    renderLiveHud();
    if (live.playingNow()) raf = requestAnimationFrame(loopLive);
  };

  const syncStudyMode = (next: Mode): void => {
    appRoot?.classList.toggle("learn-on", next === "learn" || next === "free");
    appRoot?.classList.toggle("read-on", next === "read");
    appRoot?.classList.toggle("library-on", next === "library");
  };

  const setMode = (next: Mode, opts?: { pieceId?: string }): void => {
    mode = next;
    host.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
      const on = button.dataset.mode === next;
      button.classList.toggle("active", on);
      button.setAttribute("aria-current", on ? "page" : "false");
    });
    const liveOn = next === "live";
    liveEl.hidden = !liveOn;
    appRoot?.classList.toggle("live-on", liveOn);
    syncStudyMode(next);
    piano.setAutoFollow(!liveOn);
    if (liveOn) showKeys(true, "live");
    else showKeys(false);
    syncSheetLayout();
    sequenceStrip.hidden = true;

    if (next !== "live") {
      playView = "play";
      syncPlayView();
      stopLiveLoop();
      stopCoursePlay();
    }
    if (next !== "library") libraryEl.hidden = true;
    if (next === "learn") {
      libraryEl.hidden = true;
      liveEl.hidden = true;
      renderLearn(lessons.openPath());
      return;
    }
    if (next === "read") {
      libraryEl.hidden = true;
      liveEl.hidden = true;
      renderRead(reading.openPath());
      return;
    }
    if (next === "free") {
      pathEl.hidden = true;
      liveEl.hidden = true;
      libraryEl.hidden = true;
      renderLearn(lessons.startFree());
      eyebrow.textContent = "Sandbox";
      return;
    }
    if (next === "library") {
      pathEl.hidden = true;
      stageEl.hidden = true;
      liveEl.hidden = true;
      libraryEl.hidden = false;
      rollHost && ((rollHost as HTMLElement).hidden = true);
      appRoot?.classList.toggle("live-on", false);
      showKeys(false);
      eyebrow.textContent = "Library";
      renderLibrary();
      return;
    }
    libraryEl.hidden = true;
    pathEl.hidden = true;
    stageEl.hidden = true;
    eyebrow.textContent = "Play";
    fillPieces(opts?.pieceId);
    if (opts?.pieceId) pieceSelect.value = opts.pieceId;
    loadSelectedPiece();
    syncPlayView();
    renderLiveHud();
  };

  const handleMidi = (event: MidiEvent): void => {
    if (event.type === "control" && event.controller === 64) {
      const down = event.value >= 64;
      host.classList.toggle("sustain", down);
      synth.setSustain(down);
      return;
    }
    if (event.type === "noteon") {
      synth.noteOn(event.note, event.velocity);
      piano.hold(event.note, true);
      if (mode === "read") {
        const next = reading.judge(event.note);
        if (next.lastResult === "correct") piano.setState(event.note, "correct");
        if (next.lastResult === "wrong") piano.setState(event.note, "wrong");
        renderRead(next);
      } else if (mode === "live") {
        const result = live.noteOn(event.note);
        if (result === "hit") piano.setState(event.note, "correct");
        if (result === "miss") piano.setState(event.note, "wrong");
        renderLiveHud();
      } else if (coursePlayActive) {
        const result = live.noteOn(event.note);
        if (result === "hit") piano.setState(event.note, "correct");
        if (result === "miss") piano.setState(event.note, "wrong");
        loopCoursePlay();
      } else {
        const next = lessons.judge(event.note);
        if (next.screen === "lesson") {
          if (next.lastResult === "correct") piano.setState(event.note, "correct");
          if (next.lastResult === "wrong") piano.setState(event.note, "wrong");
        }
        renderLearn(next);
      }
      return;
    }
    if (event.type === "noteoff") {
      synth.noteOff(event.note);
      piano.hold(event.note, false);
      if (mode === "learn" || mode === "free") lessons.noteOff(event.note);
    }
  };

  midi.onMessage(handleMidi);
  midi.onDevicesChanged(renderDevices);

  connectBtn.addEventListener("click", async () => {
    midiError.classList.add("hidden");
    connectBtn.disabled = true;
    connectBtn.textContent = "Waiting for permission…";
    try {
      await midi.connect();
      renderDevices();
      connectBtn.textContent = midi.selectedInput() ? "Connected" : "No keyboard found";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open MIDI.";
      midiError.textContent = message;
      midiError.classList.remove("hidden");
      connectBtn.textContent = "Connect USB MIDI";
    } finally {
      connectBtn.disabled = false;
    }
  });

  deviceSelect.addEventListener("change", () => {
    midi.selectInput(deviceSelect.value);
    renderDevices();
  });

  host.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode((button.dataset.mode as Mode) ?? "learn"));
  });

  $("[data-restart]").addEventListener("click", () => {
    if (mode === "read") renderRead(reading.restart());
    else renderLearn(lessons.restart());
  });
  backBtn.addEventListener("click", () => {
    if (mode === "read") renderRead(reading.openPath());
    else renderLearn(lessons.openPath());
  });
  nextBtn.addEventListener("click", () => {
    if (mode === "read") renderRead(reading.startNext());
    else renderLearn(lessons.startNext());
  });

  tempoInput.addEventListener("input", () => {
    const bpm = Number(tempoInput.value);
    tempoLabel.textContent = String(bpm);
    metronome.setTempo(bpm);
  });

  const toggleMetronome = (): void => {
    if (metronome.isRunning()) {
      metronome.stop();
      metroBtn.classList.remove("active");
      liveMetroBtn.classList.remove("active");
      metroBtn.textContent = "Metronome";
      liveMetroBtn.textContent = "Metro";
      return;
    }
    metronome.start();
    metroBtn.classList.add("active");
    liveMetroBtn.classList.add("active");
    metroBtn.textContent = "Stop click";
    liveMetroBtn.textContent = "Stop";
  };

  metroBtn.addEventListener("click", () => toggleMetronome());
  liveMetroBtn.addEventListener("click", () => toggleMetronome());

  pieceSelect.addEventListener("change", () => {
    playView = "play";
    stopLiveLoop();
    loadSelectedPiece();
    renderLiveHud();
  });

  livePlay.addEventListener("click", () => {
    const snap = live.snapshot();
    if (snap.finished) loadSelectedPiece();
    applyHearSettings();
    live.toggle();
    if (live.snapshot().playing) loopLive();
    else renderLiveHud();
  });

  $("[data-live-stop]").addEventListener("click", () => {
    stopLiveLoop();
    loadSelectedPiece();
    renderLiveHud();
  });

  $("[data-live-back]").addEventListener("click", () => skipSong(-SEEK_JUMP));
  $("[data-live-forward]").addEventListener("click", () => skipSong(SEEK_JUMP));
  $("[data-live-prev]").addEventListener("click", () => skipToNote(-1));
  $("[data-live-next]").addEventListener("click", () => skipToNote(1));

  liveSeek.addEventListener("pointerdown", () => {
    seekDragging = true;
  });
  liveSeek.addEventListener("pointerup", () => {
    seekDragging = false;
  });
  liveSeek.addEventListener("input", () => {
    seekSong(Number(liveSeek.value));
  });

  host.addEventListener("keydown", (event) => {
    if (mode !== "live" || playView !== "play") return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      skipSong(-SEEK_JUMP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      skipSong(SEEK_JUMP);
    } else if (event.key === "[") {
      event.preventDefault();
      skipToNote(-1);
    } else if (event.key === "]") {
      event.preventDefault();
      skipToNote(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekSong(0);
    }
  });

  const hearNotesToggle = $<HTMLInputElement>("[data-hear-notes]");
  hearNotesToggle.checked = localStorage.getItem("piano-coach-hear-notes") === "1";
  hearSongToggle.addEventListener("change", () => applyHearSettings());
  hearSongTransport.addEventListener("change", () => {
    hearSongToggle.checked = hearSongTransport.checked;
    applyHearSettings();
  });
  hearNotesTransport.addEventListener("change", () => {
    hearNotesToggle.checked = hearNotesTransport.checked;
    localStorage.setItem("piano-coach-hear-notes", hearNotesToggle.checked ? "1" : "0");
    applyHearSettings();
  });
  hearNotesToggle.addEventListener("change", () => {
    localStorage.setItem("piano-coach-hear-notes", hearNotesToggle.checked ? "1" : "0");
    applyHearSettings();
  });
  const waitToggle = $<HTMLInputElement>("[data-wait-for-me]");
  waitToggle.checked = localStorage.getItem("piano-coach-wait-for-me") === "1";
  waitToggle.addEventListener("change", () => {
    localStorage.setItem("piano-coach-wait-for-me", waitToggle.checked ? "1" : "0");
    applyWaitForPlayer();
  });
  const zoomLabel = $("[data-zoom-label]");
  const renderZoom = (zoom: number): void => {
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };
  score.onZoomChange(renderZoom);
  $("[data-zoom-out]").addEventListener("click", () => score.zoomBy(-0.15));
  $("[data-zoom-in]").addEventListener("click", () => score.zoomBy(0.15));
  $("[data-show-sheet]").addEventListener("change", () => {
    syncSheetLayout();
  });
  removeBtn.addEventListener("click", () => {
    const piece = currentPiece();
    if (piece.source === "builtin") return;
    void deleteLibraryPiece(piece.id).then(() => {
      saved = saved.filter((item) => item.id !== piece.id);
      fillPieces();
      stopLiveLoop();
      loadSelectedPiece();
      renderLiveHud();
      setImportMessage(`Removed ${piece.title} from your library.`);
      renderLibrary();
    });
  });

  host.querySelectorAll<HTMLButtonElement>("[data-play-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = (button.dataset.playView as PlayView) ?? "play";
      setPlayView(next);
    });
  });

  exportBtn.addEventListener("click", () => exportPieceMidi(currentPiece()));
  exportXmlBtn.addEventListener("click", () => exportPieceMusicXml(currentPiece()));

  const retranscribePiece = async (piece: Piece): Promise<void> => {
    if (importBusy) return;
    if (piece.source !== "audio") {
      setImportMessage("Re-transcribe only works for songs imported from audio.");
      return;
    }
    if (!window.confirm(`Re-transcribe "${piece.title}"? This replaces the notes with a fresh transcription.`)) return;

    importBusy = true;
    retranscribeBtn.disabled = true;
    showImportOverlay(piece.title, true);
    reportImportProgress(2, "Loading audio");
    try {
      let audio = piece.audio;
      let file: File | null = null;
      const stored = await getLibraryAudioBytes(piece.id);
      if (stored) {
        const ext = stored.type.includes("wav") ? "wav" : stored.type.includes("mpeg") ? "mp3" : "audio";
        file = new File([stored.bytes], `${piece.title}.${ext}`, { type: stored.type });
        if (!audio) {
          const context = new AudioContext();
          audio = await context.decodeAudioData(stored.bytes.slice(0));
          void context.close();
        }
      }
      if (!audio) {
        throw new Error("Original audio not found. Re-import the MP3 to enable re-transcribe.");
      }
      if (!file) file = audioBufferToWavFile(audio, piece.title);

      const mode = normalizeTileMode(tileModeSelect.value);
      const target = normalizeTranscribeTarget(transcribeTargetSelect.value) as TranscribeTarget;
      await probeMuScriptor();
      startImportPulse();
      let result;
      try {
        result = await transcribeAudioFile(
          file,
          audio,
          (pct, label) => {
            if (pct >= 35 || /transcribing|model ready|creating score|reading notes/i.test(label ?? "")) {
              stopImportPulse();
            }
            reportImportProgress(pct, label);
          },
          mode,
          target,
        );
      } finally {
        stopImportPulse();
      }

      const updated: Piece = {
        ...piece,
        notes: result.notes,
        fullNotes: result.fullNotes,
        voiceNotes: result.voiceNotes,
        instNotes: result.instNotes,
        leftHandNotes: result.leftHandNotes,
        rightHandNotes: result.rightHandNotes,
        audio,
        audioOffset: result.offset,
        audioDurationSec: audio.duration,
        savedAt: Date.now(),
      };
      await saveLibraryPiece(updated);
      saved = [updated, ...saved.filter((item) => item.id !== updated.id)];
      fillPieces(updated.id);
      renderLibrary();
      stopLiveLoop();
      playView = "play";
      loadSelectedPiece();
      syncPlayView();
      renderLiveHud();
      const engineLabel = result.engine.includes("muscriptor") ? MUSCRIPTOR_LABEL : result.engine;
      setImportMessage(`Re-transcribed ${result.fullNotes.length} notes (${engineLabel}).`);
      finishImportOverlay(true, `${updated.title} re-transcribed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Re-transcribe failed.";
      setImportMessage(message);
      finishImportOverlay(false, message);
    } finally {
      retranscribeBtn.disabled = false;
      importBusy = false;
    }
  };

  retranscribeBtn.addEventListener("click", () => {
    void retranscribePiece(currentPiece());
  });

  const setImportProgress = (pct: number, on: boolean): void => {
    const width = `${Math.max(0, Math.min(100, pct))}%`;
    importProgress.classList.toggle("hidden", !on);
    libraryProgress.classList.toggle("hidden", !on);
    importBar.style.width = width;
    libraryBar.style.width = width;
    importOverlayBar.style.width = width;
  };

  const setImportStepUI = (pct: number, label?: string): void => {
    const { step, detail } = resolveImportProgress(pct, label);
    const activeIdx = stepIndex(step);
    importStepsList.querySelectorAll<HTMLElement>(".import-step").forEach((el) => {
      const id = el.dataset.importStep as ImportStepId | undefined;
      if (!id) return;
      const idx = stepIndex(id);
      el.classList.toggle("done", idx < activeIdx);
      el.classList.toggle("active", idx === activeIdx);
      el.classList.toggle("pending", idx > activeIdx);
    });
    importStepDetail.textContent = detail ?? IMPORT_STEPS.find((item) => item.id === step)?.label ?? "";
  };

  const showImportOverlay = (fileName: string, on: boolean): void => {
    importOverlayOpen = on;
    importOverlay.classList.toggle("hidden", !on);
    importOverlay.classList.remove("import-overlay-error");
    importDismiss.classList.add("hidden");
    if (on) {
      importFileName.textContent = fileName;
      importStepsList.querySelectorAll(".import-step").forEach((el) => {
        el.classList.remove("done", "active");
        el.classList.add("pending");
      });
      const first = importStepsList.querySelector('[data-import-step="received"]');
      first?.classList.remove("pending");
      first?.classList.add("active");
    }
  };

  const stopImportPulse = (): void => {
    if (importPulseTimer) window.clearInterval(importPulseTimer);
    importPulseTimer = 0;
  };

  const startImportPulse = (): void => {
    stopImportPulse();
    importStartedAt = Date.now();
    const cpuHint =
      muScriptorDevice() === "cpu"
        ? "CPU mode — a full song can take 10–20 min"
        : "GPU quality mode — ~8–15 min for a 4 min song";
    let pct = 12;
    const tick = (): void => {
      if (pct < 34) {
        const elapsed = formatImportElapsed(Date.now() - importStartedAt);
        reportImportProgress(
          Math.round(pct),
          `Detecting Notes · starting MuScriptor (${elapsed} — ${cpuHint})`,
        );
        pct += 0.6;
      }
    };
    tick();
    importPulseTimer = window.setInterval(tick, 2000);
  };

  const markImportStepsDone = (): void => {
    importStepsList.querySelectorAll(".import-step").forEach((el) => {
      el.classList.remove("pending", "active");
      el.classList.add("done");
    });
  };

  const closeImportOverlay = (delayMs = 0): void => {
    if (importOverlayTimer) window.clearTimeout(importOverlayTimer);
    importOverlayTimer = 0;
    stopImportPulse();
    const close = (): void => {
      showImportOverlay("", false);
      setImportProgress(0, false);
    };
    if (delayMs > 0) importOverlayTimer = window.setTimeout(close, delayMs);
    else close();
  };

  const finishImportOverlay = (ok: boolean, message: string): void => {
    stopImportPulse();
    if (!importOverlayOpen) return;
    if (ok) {
      markImportStepsDone();
      reportImportProgress(100, message);
      closeImportOverlay(1800);
      return;
    }
    importOverlay.classList.add("import-overlay-error");
    importStepDetail.textContent = message;
    importDismiss.classList.remove("hidden");
  };

  const setImportMessage = (message: string): void => {
    importStatus.textContent = message;
    libraryStatus.textContent = message;
  };

  const reportImportProgress = (pct: number, label?: string): void => {
    setImportProgress(pct, true);
    setImportStepUI(pct, label);
    if (label) setImportMessage(label);
  };

  let importBusy = false;

  const importFile = async (file: File): Promise<void> => {
    if (importBusy) return;
    importBusy = true;
    importInput.disabled = true;
    libraryImportInput.disabled = true;
    importBox.classList.add("busy");
    libraryImportBox.classList.add("busy");
    const isAudio =
      !/\.mid(i)?$/i.test(file.name) &&
      !file.type.includes("midi") &&
      !isMusicXmlFile(file.name, file.type);
    showImportOverlay(file.name, isAudio);
    reportImportProgress(2, "File Received");
    try {
      if (file.size > 80 * 1024 * 1024) {
        throw new Error("That file is larger than 80 MB.");
      }
      const buffer = await file.arrayBuffer();
      const isMidi = /\.mid(i)?$/i.test(file.name) || file.type.includes("midi");
      const isXml = isMusicXmlFile(file.name, file.type);
      let piece: Piece;
      if (isMidi) {
        const parsed = parseMidi(buffer);
        piece = {
          id: `import-${Date.now()}`,
          title: parsed.title || file.name,
          source: "midi",
          notes: parsed.notes,
          fullNotes: parsed.notes,
        };
        reportImportProgress(100, "Creating Score");
        await saveLibraryPiece(piece);
        setImportMessage(`Saved ${piece.notes.length} notes from MIDI to your library.`);
      } else if (isXml) {
        reportImportProgress(40, "Detecting Notes");
        setImportMessage("Reading MusicXML…");
        const xml = await loadMusicXmlText(buffer, file.name);
        const parsed = parseMusicXml(xml);
        piece = {
          id: `import-${Date.now()}`,
          title: parsed.title || file.name.replace(/\.[^.]+$/, ""),
          source: "musicxml",
          notes: parsed.notes,
          fullNotes: parsed.notes,
        };
        reportImportProgress(100, "Creating Score");
        await saveLibraryPiece(piece);
        setImportMessage(`Saved ${piece.notes.length} notes from sheet music (MusicXML).`);
      } else {
        reportImportProgress(6, "Processing Audio");
        const context = new AudioContext();
        const audio = await context.decodeAudioData(buffer.slice(0));
        void context.close();
        const mode = normalizeTileMode(tileModeSelect.value);
        const target = normalizeTranscribeTarget(transcribeTargetSelect.value) as TranscribeTarget;
        await probeMuScriptor();
        startImportPulse();
        let result;
        try {
          result = await transcribeAudioFile(
            file,
            audio,
            (pct, label) => {
              if (pct >= 35 || /transcribing|model ready|creating score|reading notes/i.test(label ?? "")) {
                stopImportPulse();
              }
              reportImportProgress(pct, label);
            },
            mode,
            target,
          );
        } finally {
          stopImportPulse();
        }
        piece = {
          id: `import-${Date.now()}`,
          title: file.name.replace(/\.[^.]+$/, ""),
          source: "audio",
          notes: result.notes,
          fullNotes: result.fullNotes,
          voiceNotes: result.voiceNotes,
          instNotes: result.instNotes,
          leftHandNotes: result.leftHandNotes,
          rightHandNotes: result.rightHandNotes,
          audio,
          audioOffset: result.offset,
          audioDurationSec: audio.duration,
        };
        await saveLibraryPiece(piece, buffer, file.type || "audio/mpeg");
        const melody = result.voiceNotes.length;
        const inst = result.instNotes.length;
        const engineLabel = result.engine.includes("muscriptor") ? MUSCRIPTOR_LABEL : result.engine;
        setImportMessage(
          melody > 0 && inst > 0
            ? `Piano ${inst} + vocal ${melody} notes (${engineLabel}). Tiles: Piano / Vocals / Left / Right hand.`
            : `Converted ${result.fullNotes.length} notes (${engineLabel}).`,
        );
      }
      piece.savedAt = Date.now();
      saved = [piece, ...saved.filter((item) => item.id !== piece.id)];
      localStorage.setItem(COURSE_PIECE_KEY, piece.id);
      fillPieces(piece.id);
      renderLibrary();
      stopLiveLoop();
      setMode("live");
      playView = "play";
      loadSelectedPiece();
      syncPlayView();
      renderLiveHud();
      setImportMessage(
        `${piece.title}: ${(piece.fullNotes ?? piece.notes).length} notes transcribed (Hard = full song). Re-import old songs for the full transcription.`,
      );
      window.setTimeout(() => piano.centerOnMiddleC(), 80);
      if (isAudio) {
        finishImportOverlay(true, `${piece.title} is ready`);
      } else {
        closeImportOverlay(900);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read that file.";
      setImportMessage(message);
      if (isAudio) finishImportOverlay(false, message);
      else setImportProgress(0, false);
    } finally {
      importInput.value = "";
      libraryImportInput.value = "";
      importInput.disabled = false;
      libraryImportInput.disabled = false;
      importBox.classList.remove("busy");
      libraryImportBox.classList.remove("busy");
      importBusy = false;
    }
  };

  importDismiss.addEventListener("click", () => closeImportOverlay());

  newImportBtn.addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
    settingsToggle.classList.remove("active");
    importInput.click();
  });

  settingsToggle.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
    settingsToggle.classList.toggle("active", !settingsPanel.hidden);
  });

  sidebarRecents.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-recent-id]");
    if (!button?.dataset.recentId) return;
    playLibraryPiece(button.dataset.recentId);
  });

  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (file) void importFile(file);
  });

  importSecondary.addEventListener("change", () => {
    const file = importSecondary.files?.[0];
    if (file) void importFile(file);
  });

  ["dragenter", "dragover"].forEach((name) => {
    importBox.addEventListener(name, (event) => {
      event.preventDefault();
      importBox.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    importBox.addEventListener(name, (event) => {
      event.preventDefault();
      importBox.classList.remove("drag");
    });
  });
  importBox.addEventListener("drop", (event) => {
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file) void importFile(file);
  });

  libraryImportInput.addEventListener("change", () => {
    const file = libraryImportInput.files?.[0];
    if (file) void importFile(file);
  });
  ["dragenter", "dragover"].forEach((name) => {
    libraryImportBox.addEventListener(name, (event) => {
      event.preventDefault();
      libraryImportBox.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    libraryImportBox.addEventListener(name, (event) => {
      event.preventDefault();
      libraryImportBox.classList.remove("drag");
    });
  });
  libraryImportBox.addEventListener("drop", (event) => {
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file) void importFile(file);
  });

  libraryList.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>("[data-library-item]");
    if (!item) return;
    const id = item.dataset.libraryItem;
    if (!id) return;
    const piece = saved.find((entry) => entry.id === id);
    if (!piece) return;
    if (target.closest("[data-library-play]")) {
      playLibraryPiece(id);
      return;
    }
    if (target.closest("[data-library-rename]")) {
      const next = window.prompt("Rename song", piece.title)?.trim();
      if (!next || next === piece.title) return;
      piece.title = next;
      void saveLibraryPiece(piece).then(() => {
        fillPieces(id);
        renderLibrary();
        setImportMessage(`Renamed to "${next}".`);
      });
      return;
    }
    if (target.closest("[data-library-retranscribe]")) {
      void retranscribePiece(piece);
      return;
    }
    if (target.closest("[data-library-export]")) {
      exportPieceMidi(piece);
      return;
    }
    if (target.closest("[data-library-delete]")) {
      if (!window.confirm(`Delete "${piece.title}" from your library?`)) return;
      void deleteLibraryPiece(id).then(() => {
        saved = saved.filter((entry) => entry.id !== id);
        fillPieces();
        renderLibrary();
        if (mode === "live") {
          stopLiveLoop();
          loadSelectedPiece();
          renderLiveHud();
        }
        setImportMessage(`Removed "${piece.title}".`);
      });
    }
  });

  libraryEmptyBtn.addEventListener("click", () => {
    if (saved.length === 0) return;
    if (!window.confirm("Delete every song in your library?")) return;
    void clearLibrary().then(() => {
      saved = [];
      fillPieces();
      renderLibrary();
      stopLiveLoop();
      if (mode === "live") {
        loadSelectedPiece();
        renderLiveHud();
      }
      setImportMessage("Library emptied.");
    });
  });

  tileModeSelect.addEventListener("focus", () => {
    tileModeSelect.dataset.last = tileModeSelect.value;
  });

  tileModeSelect.addEventListener("change", () => {
    localStorage.setItem("piano-coach-tile-mode", tileModeSelect.value);
    if (playView === "review") return;
    const piece = currentPiece();
    if (
      !(piece.voiceNotes?.length || piece.instNotes?.length || piece.leftHandNotes?.length || piece.fullNotes?.length)
    ) {
      return;
    }
    const mode = playbackMode(piece);
    piece.notes = applyTileMode(playbackLayers(piece), mode);
    const match = saved.find((item) => item.id === piece.id);
    if (match) match.notes = piece.notes;
    void saveLibraryPiece(piece);
    stopLiveLoop();
    loadSelectedPiece();
    renderLiveHud();
    const label =
      mode === "voice"
        ? "Vocals"
        : mode === "instruments"
          ? "Piano"
          : mode === "left"
            ? "Left hand"
            : mode === "right"
              ? "Right hand"
              : "All notes";
    importStatus.textContent = `${label}: ${piece.notes.length} notes (faithful).`;
  });

  const refreshSongLearning = (): void => {
    const level = normalizeSongLevel(songLevelSelect.value);
    localStorage.setItem("piano-coach-song-level", level);
    localStorage.setItem("piano-coach-song-key", songKeySelect.value);
    localStorage.setItem("piano-coach-song-mode", songModeSelect.value);
    stopLiveLoop();
    loadSelectedPiece();
    renderLiveHud();
    const piece = currentPiece();
    const count = playableNotes(piece).length;
    const key = resolveSongKey(rawNotesForPiece(piece), songKeyPreference()).label;
    const label = level === "easy" ? "Easy" : level === "hard" ? "Hard" : "Medium";
    const levelHint =
      level === "easy" ? "vocals" : level === "hard" ? "full song" : "vocals + chords";
    importStatus.textContent = `${label} · ${levelHint} · ${key}: ${count} notes.`;
  };

  songLevelSelect.addEventListener("change", () => {
    refreshSongLearning();
    if (playView === "review") refreshReviewEditor();
  });
  songKeySelect.addEventListener("change", refreshSongLearning);
  songModeSelect.addEventListener("change", refreshSongLearning);

  const refreshConverterHint = async (): Promise<void> => {
    const ready = await probeMuScriptor();
    const hint = ready
      ? "Ready — drop a song. MuScriptor transcribes it to notes and sheet music (Songscription-style)."
      : "Drop MP3, MIDI, or MusicXML above. Run scripts/setup-muscriptor.ps1 and log in to Hugging Face first.";
    if (!importStatus.textContent?.includes("Converted") && !importStatus.textContent?.includes("Saved")) {
      importStatus.textContent = hint;
    }
    if (!libraryStatus.textContent?.includes("Converted") && !libraryStatus.textContent?.includes("Saved")) {
      libraryStatus.textContent = "Your saved songs — import from the Play tab.";
    }
  };

  fillPieces();
  renderSidebarRecents();
  loadSelectedPiece();
  setMode(isDesktopApp ? "live" : "learn");
  window.setTimeout(() => piano.centerOnMiddleC(), 80);
  void refreshConverterHint();
  void wipeOldLibraryOnce()
    .then(() => listLibraryPieces())
    .then((pieces) => {
      saved = pieces;
      fillPieces();
      renderLibrary();
      if (mode === "live") {
        loadSelectedPiece();
        renderLiveHud();
      }
    });
}
