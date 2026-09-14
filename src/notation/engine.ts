import { prettyName, randomInt } from "../music/notes";
import { awardPractice, lessonXp } from "../lessons/game";
import {
  isUnlocked,
  loadProgress,
  nextIncompleteId,
  recordAttempt,
  starsFor,
  type ProgressMap,
  type Stars,
} from "../lessons/progress";
import { READING_LEVELS, readingById, readingIndex, type ReadingLevel } from "./curriculum";

const STORAGE_KEY = "piano-coach-reading-v1";

export type ReadingSnapshot = {
  screen: "path" | "lesson";
  level: ReadingLevel | null;
  levelNumber: number;
  levelTotal: number;
  title: string;
  skill: string;
  teach: string;
  course: string[];
  prompt: string;
  expected: number[];
  sequence: number[];
  index: number;
  goal: number;
  complete: boolean;
  stars: Stars;
  lastResult: "idle" | "correct" | "wrong";
  correct: number;
  wrong: number;
  streak: number;
  showHint: boolean;
  showName: boolean;
  records: ProgressMap;
  continueId: string;
  xpEarned: number;
};

export class ReadingEngine {
  private screen: "path" | "lesson" = "path";
  private level: ReadingLevel | null = null;
  private sequence: number[] = [];
  private index = 0;
  private lastResult: ReadingSnapshot["lastResult"] = "idle";
  private correct = 0;
  private wrong = 0;
  private streak = 0;
  private lastTarget: number | null = null;
  private records: ProgressMap = loadProgress(STORAGE_KEY);
  private savedThisAttempt = false;
  private lastXp = 0;

  snapshot(): ReadingSnapshot {
    const complete = this.isComplete();
    const stars = complete ? starsFor(this.wrong, this.correct) : 0;
    return {
      screen: this.screen,
      level: this.level,
      levelNumber: this.level ? readingIndex(this.level.id) + 1 : 0,
      levelTotal: READING_LEVELS.length,
      title: this.level?.title ?? "Read music",
      skill: this.level?.skill ?? "Learn the staff",
      teach: this.level?.teach ?? "",
      course: this.level?.course ?? (this.level?.teach ? [this.level.teach] : []),
      prompt: this.prompt(complete, stars),
      expected: complete ? [] : this.expected(),
      sequence: [...this.sequence],
      index: this.index,
      goal: this.goal(),
      complete,
      stars,
      lastResult: this.lastResult,
      correct: this.correct,
      wrong: this.wrong,
      streak: this.streak,
      showHint: this.level?.showHint ?? false,
      showName: this.level?.showName ?? false,
      records: this.records,
      continueId: nextIncompleteId(this.records, READING_LEVELS),
      xpEarned: complete ? this.lastXp : 0,
    };
  }

  openPath(): ReadingSnapshot {
    this.screen = "path";
    this.level = null;
    this.sequence = [];
    this.reset();
    return this.snapshot();
  }

  startLevel(id: string): ReadingSnapshot {
    const level = readingById(id);
    if (!level || !isUnlocked(id, this.records, READING_LEVELS)) return this.openPath();
    this.screen = "lesson";
    this.level = level;
    this.reset();
    this.build();
    return this.snapshot();
  }

  startContinue(): ReadingSnapshot {
    return this.startLevel(nextIncompleteId(this.records, READING_LEVELS));
  }

  startNext(): ReadingSnapshot {
    if (!this.level) return this.startContinue();
    const next = READING_LEVELS[readingIndex(this.level.id) + 1];
    return next ? this.startLevel(next.id) : this.openPath();
  }

  restart(): ReadingSnapshot {
    return this.level ? this.startLevel(this.level.id) : this.openPath();
  }

  judge(note: number): ReadingSnapshot {
    if (this.screen !== "lesson" || !this.level || this.isComplete()) {
      this.lastResult = "idle";
      return this.snapshot();
    }
    const target = this.expected()[0];
    if (target === undefined) return this.snapshot();
    if (note === target) {
      this.correct += 1;
      this.streak += 1;
      this.lastResult = "correct";
      this.lastTarget = target;
      if (this.level.kind === "find") {
        if (this.correct >= this.goal()) this.finish();
        else this.nextFind();
      } else {
        this.index += 1;
        if (this.index >= this.sequence.length) this.finish();
      }
    } else {
      this.wrong += 1;
      this.streak = 0;
      this.lastResult = "wrong";
    }
    return this.snapshot();
  }

  private finish(): void {
    if (!this.level || this.savedThisAttempt) return;
    const stars = starsFor(this.wrong, this.correct);
    const firstClear = (this.records[this.level.id]?.stars ?? 0) < 1;
    this.lastXp = lessonXp(stars, firstClear);
    awardPractice(this.lastXp);
    this.records = recordAttempt(this.records, this.level.id, stars, this.wrong, STORAGE_KEY);
    this.savedThisAttempt = true;
  }

  private prompt(complete: boolean, stars: Stars): string {
    if (this.screen === "path") return "Read the staff, then play what you see.";
    if (complete) return stars >= 3 ? "Clean reading." : "Cleared. Replay to read it cleaner.";
    const target = this.expected()[0];
    if (target === undefined) return this.level?.teach ?? "";
    return this.level?.showName ? `Play ${prettyName(target)}` : "Play the written note.";
  }

  private expected(): number[] {
    const note = this.level?.kind === "find" ? this.sequence[0] : this.sequence[this.index];
    return note === undefined ? [] : [note];
  }

  private goal(): number {
    if (!this.level) return 0;
    return this.level.kind === "find" ? this.level.goal ?? 8 : this.level.notes.length;
  }

  private isComplete(): boolean {
    if (this.screen !== "lesson" || !this.level) return false;
    return this.level.kind === "find" ? this.correct >= this.goal() : this.index >= this.sequence.length && this.sequence.length > 0;
  }

  private reset(): void {
    this.index = 0;
    this.correct = 0;
    this.wrong = 0;
    this.streak = 0;
    this.lastResult = "idle";
    this.lastTarget = null;
    this.savedThisAttempt = false;
    this.lastXp = 0;
  }

  private build(): void {
    if (!this.level) {
      this.sequence = [];
      return;
    }
    if (this.level.kind === "find") {
      this.nextFind();
      return;
    }
    this.sequence = [...this.level.notes];
  }

  private nextFind(): void {
    const pool = this.level?.notes ?? [];
    let pick = pool[randomInt(0, Math.max(0, pool.length - 1))] ?? 60;
    let guard = 0;
    while (pool.length > 1 && pick === this.lastTarget && guard < 12) {
      pick = pool[randomInt(0, pool.length - 1)] ?? pick;
      guard += 1;
    }
    this.sequence = [pick];
    this.index = 0;
  }
}
