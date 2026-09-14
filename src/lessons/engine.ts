import { prettyChord, prettyName, randomInt } from "../music/notes";
import {
  LEVELS,
  asSteps,
  levelById,
  levelIndex,
  levelSequenceSteps,
  levelTimedNotes,
  type Hand,
  type LevelDef,
} from "./curriculum";
import type { TimedNote } from "../music/timed";
import { awardPractice, lessonXp } from "./game";
import {
  isUnlocked,
  loadProgress,
  nextIncompleteId,
  recordAttempt,
  starsFor,
  type ProgressMap,
  type Stars,
} from "./progress";

export type Screen = "path" | "lesson" | "free";

export type LessonSnapshot = {
  screen: Screen;
  level: LevelDef | null;
  levelNumber: number;
  levelTotal: number;
  title: string;
  skill: string;
  teach: string;
  course: string[];
  hand: Hand | null;
  fingers: string;
  prompt: string;
  expected: number[];
  sequence: number[][];
  index: number;
  goal: number;
  complete: boolean;
  stars: Stars;
  lastResult: "idle" | "correct" | "wrong";
  correct: number;
  wrong: number;
  streak: number;
  showHint: boolean;
  playMode: boolean;
  records: ProgressMap;
  continueId: string;
  xpEarned: number;
};

export class LessonEngine {
  private screen: Screen = "path";
  private level: LevelDef | null = null;
  private sequence: number[][] = [];
  private index = 0;
  private lastResult: LessonSnapshot["lastResult"] = "idle";
  private correct = 0;
  private wrong = 0;
  private streak = 0;
  private lastTarget: string | null = null;
  private held = new Set<number>();
  private records: ProgressMap = loadProgress();
  private savedThisAttempt = false;
  private lastXp = 0;
  private playFinished = false;
  private courseNotes: TimedNote[] | null = null;

  snapshot(): LessonSnapshot {
    const goal = this.goal();
    const complete = this.isComplete();
    const stars = complete ? starsFor(this.wrong, this.correct) : 0;
    return {
      screen: this.screen,
      level: this.level,
      levelNumber: this.level ? levelIndex(this.level.id) + 1 : 0,
      levelTotal: LEVELS.length,
      title: this.title(),
      skill: this.level?.skill ?? (this.screen === "free" ? "Sandbox" : "Learn path"),
      teach: this.level?.teach ?? "",
      course: this.level?.course ?? [],
      hand: this.level?.hand ?? null,
      fingers: this.level?.fingers ?? "",
      prompt: this.prompt(complete, stars),
      expected: complete ? [] : this.expected(),
      sequence: this.sequence.map((step) => [...step]),
      index: this.index,
      goal,
      complete,
      stars,
      lastResult: this.lastResult,
      correct: this.correct,
      wrong: this.wrong,
      streak: this.streak,
      showHint: this.level?.showHint ?? false,
      playMode: this.level?.kind === "play",
      records: this.records,
      continueId: nextIncompleteId(this.records),
      xpEarned: complete ? this.lastXp : 0,
    };
  }

  openPath(): LessonSnapshot {
    this.screen = "path";
    this.level = null;
    this.sequence = [];
    this.courseNotes = null;
    this.resetAttempt();
    return this.snapshot();
  }

  startFree(): LessonSnapshot {
    this.screen = "free";
    this.level = null;
    this.sequence = [];
    this.resetAttempt();
    return this.snapshot();
  }

  startLevel(id: string, opts?: { courseNotes?: TimedNote[] }): LessonSnapshot {
    const level = levelById(id);
    if (!level || !isUnlocked(id, this.records)) return this.openPath();
    this.screen = "lesson";
    this.level = level;
    this.courseNotes = opts?.courseNotes ?? null;
    this.resetAttempt();
    this.build();
    return this.snapshot();
  }

  startContinue(): LessonSnapshot {
    return this.startLevel(nextIncompleteId(this.records));
  }

  startNext(): LessonSnapshot {
    if (!this.level) return this.startContinue();
    const next = LEVELS[levelIndex(this.level.id) + 1];
    if (!next) return this.openPath();
    return this.startLevel(next.id);
  }

  restart(): LessonSnapshot {
    if (this.screen === "free") return this.startFree();
    if (!this.level) return this.openPath();
    const preserved = this.courseNotes;
    return this.startLevel(this.level.id, preserved ? { courseNotes: preserved.map((note) => ({ ...note })) } : undefined);
  }

  finishPlay(hits: number, misses: number): LessonSnapshot {
    if (this.screen !== "lesson" || !this.level || this.level.kind !== "play" || this.playFinished) {
      return this.snapshot();
    }
    this.correct = hits;
    this.wrong = misses;
    this.playFinished = true;
    this.finish();
    return this.snapshot();
  }

  noteOff(note: number): void {
    this.held.delete(note);
  }

  judge(note: number): LessonSnapshot {
    return this.noteOn(note);
  }

  noteOn(note: number): LessonSnapshot {
    this.held.add(note);
    if (this.screen !== "lesson" || !this.level || this.isComplete()) {
      this.lastResult = "idle";
      return this.snapshot();
    }

    if (this.level.kind === "play") {
      this.lastResult = "idle";
      return this.snapshot();
    }

    if (this.level.kind === "hold") {
      return this.judgeHold(note);
    }

    const target = this.expected();
    if (target.length === 0) return this.snapshot();

    if (target.length === 1) {
      if (note === target[0]) this.markCorrect(target);
      else this.markWrong();
      return this.snapshot();
    }

    if (!target.includes(note)) {
      this.markWrong();
      return this.snapshot();
    }
    if (target.every((item) => this.held.has(item))) this.markCorrect(target);
    else this.lastResult = "idle";
    return this.snapshot();
  }

  private judgeHold(note: number): LessonSnapshot {
    const bass = this.level?.bass;
    if (bass === undefined) return this.snapshot();
    if (note === bass) {
      this.lastResult = "idle";
      return this.snapshot();
    }
    if (!this.held.has(bass)) {
      this.markWrong();
      return this.snapshot();
    }
    const target = this.expected()[0];
    if (target === undefined) return this.snapshot();
    if (note === target) this.markCorrect([target]);
    else this.markWrong();
    return this.snapshot();
  }

  private markCorrect(step: number[]): void {
    this.correct += 1;
    this.streak += 1;
    this.lastResult = "correct";
    this.lastTarget = step.slice().sort((a, b) => a - b).join("-");
    if (this.level?.kind === "find") {
      if (this.correct >= this.goal()) this.finish();
      else this.nextFindNote();
      return;
    }
    this.index += 1;
    if (this.index >= this.sequence.length) this.finish();
  }

  private markWrong(): void {
    this.wrong += 1;
    this.streak = 0;
    this.lastResult = "wrong";
  }

  private finish(): void {
    if (!this.level || this.savedThisAttempt) return;
    const stars = starsFor(this.wrong, this.correct);
    const firstClear = (this.records[this.level.id]?.stars ?? 0) < 1;
    this.lastXp = lessonXp(stars, firstClear);
    awardPractice(this.lastXp);
    this.records = recordAttempt(this.records, this.level.id, stars, this.wrong);
    this.savedThisAttempt = true;
  }

  private title(): string {
    if (this.screen === "free") return "Free play";
    if (this.screen === "path") return "Your path";
    return this.level?.title ?? "Lesson";
  }

  private prompt(complete: boolean, stars: Stars): string {
    if (this.screen === "free") return "Play anything. Keys light up as you go.";
    if (this.screen === "path") return "Clear a level to unlock the next one. Stars come from accuracy.";
    if (complete) {
      if (stars >= 3) return "Clean run. That level is yours.";
      if (stars === 2) return "Cleared. Replay if you want a clean run.";
      return "Cleared. You can replay for fewer misses, or go on.";
    }
    if (this.level?.kind === "play") {
      return "Hit the falling notes in time. Use Restart if you want another run.";
    }
    const target = this.expected();
    if (this.level?.kind === "hold") {
      const bass = this.level.bass;
      const melody = target[0];
      if (bass === undefined || melody === undefined) return this.level.teach;
      if (!this.held.has(bass)) return `Hold ${prettyLabelSafe(bass)} in the left hand, then play ${prettyName(melody)}.`;
      return `Keep ${prettyLabelSafe(bass)} down · play ${prettyName(melody)}`;
    }
    if (target.length === 0) return this.level?.teach ?? "Ready when you are.";
    if (target.length > 1) return `Play together: ${prettyChord(target)}`;
    const name = target[0] === undefined ? "" : prettyName(target[0]);
    return this.level?.kind === "find" ? `Play ${name}` : `Next: ${name}`;
  }

  private expected(): number[] {
    if (this.level?.kind === "find") return [...(this.sequence[0] ?? [])];
    return [...(this.sequence[this.index] ?? [])];
  }

  private goal(): number {
    if (!this.level) return 0;
    if (this.level.kind === "play") return this.sequence.length || this.level.notes.length;
    if (this.level.kind === "find") return this.level.goal ?? this.level.notes.length;
    return this.sequence.length || this.level.notes.length;
  }

  private isComplete(): boolean {
    if (this.screen !== "lesson" || !this.level) return false;
    if (this.level.kind === "play") return this.playFinished;
    if (this.level.kind === "find") return this.correct >= this.goal();
    return this.sequence.length > 0 && this.index >= this.sequence.length;
  }

  private resetAttempt(): void {
    this.index = 0;
    this.correct = 0;
    this.wrong = 0;
    this.streak = 0;
    this.lastResult = "idle";
    this.lastTarget = null;
    this.savedThisAttempt = false;
    this.lastXp = 0;
    this.playFinished = false;
  }

  private build(): void {
    if (!this.level) {
      this.sequence = [];
      return;
    }
    if (this.level.kind === "find") {
      this.nextFindNote();
      return;
    }
    if (this.level.kind === "play") {
      const timed = this.courseNotes ?? levelTimedNotes(this.level);
      this.sequence = timed.map((note) => [note.note]);
      this.index = 0;
      return;
    }
    this.sequence = asSteps(levelSequenceSteps(this.level, this.courseNotes ?? undefined));
    this.index = 0;
  }

  private nextFindNote(): void {
    const pool = asSteps(this.level?.notes ?? []);
    if (pool.length === 0) {
      this.sequence = [];
      return;
    }
    let pick = pool[randomInt(0, pool.length - 1)] ?? pool[0] ?? [60];
    let guard = 0;
    while (pool.length > 1 && pick.join("-") === this.lastTarget && guard < 12) {
      pick = pool[randomInt(0, pool.length - 1)] ?? pick;
      guard += 1;
    }
    this.sequence = [pick];
    this.index = 0;
  }
}

function prettyLabelSafe(midi: number): string {
  return prettyChord([midi]);
}
