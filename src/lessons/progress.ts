import { LEVELS } from "./curriculum";

const STORAGE_KEY = "piano-coach-progress-v3";

export type Stars = 0 | 1 | 2 | 3;

export type LevelRecord = {
  stars: Stars;
  attempts: number;
  bestWrong: number | null;
};

export type ProgressMap = Record<string, LevelRecord>;

type SavedProgress = {
  records: ProgressMap;
};

export function loadProgress(key = STORAGE_KEY): ProgressMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedProgress;
    return parsed.records ?? {};
  } catch {
    return {};
  }
}

export function saveProgress(records: ProgressMap, key = STORAGE_KEY): void {
  localStorage.setItem(key, JSON.stringify({ records }));
}

export function starsFor(wrong: number, correct: number): Stars {
  if (correct <= 0) return 0;
  if (wrong === 0) return 3;
  if (wrong <= Math.max(1, Math.floor(correct * 0.15))) return 2;
  return 1;
}

export function recordAttempt(
  records: ProgressMap,
  levelId: string,
  stars: Stars,
  wrong: number,
  key = STORAGE_KEY,
): ProgressMap {
  const previous = records[levelId];
  const next: LevelRecord = {
    stars: Math.max(previous?.stars ?? 0, stars) as Stars,
    attempts: (previous?.attempts ?? 0) + 1,
    bestWrong: previous?.bestWrong === null || previous?.bestWrong === undefined
      ? wrong
      : Math.min(previous.bestWrong, wrong),
  };
  const updated = { ...records, [levelId]: next };
  saveProgress(updated, key);
  return updated;
}

export function isUnlocked(levelId: string, records: ProgressMap, levels: { id: string }[] = LEVELS): boolean {
  const index = levels.findIndex((level) => level.id === levelId);
  if (index <= 0) return true;
  if ((records[levelId]?.stars ?? 0) >= 1) return true;
  const previous = levels[index - 1];
  return previous ? (records[previous.id]?.stars ?? 0) >= 1 : true;
}

export function nextIncompleteId(records: ProgressMap, levels: { id: string }[] = LEVELS): string {
  return levels.find((level) => (records[level.id]?.stars ?? 0) < 1)?.id ?? levels[0]?.id ?? "my-song-easy-play";
}

export function clearedCount(records: ProgressMap, levels: { id: string }[] = LEVELS): number {
  return levels.filter((level) => (records[level.id]?.stars ?? 0) >= 1).length;
}
