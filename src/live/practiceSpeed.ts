const STORAGE_KEY = "piano-coach-practice-speed";

export const PRACTICE_SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
export type PracticeSpeed = (typeof PRACTICE_SPEEDS)[number];

export function loadPracticeSpeed(): PracticeSpeed {
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return (PRACTICE_SPEEDS as readonly number[]).includes(raw) ? (raw as PracticeSpeed) : 1;
}

export function savePracticeSpeed(speed: PracticeSpeed): void {
  localStorage.setItem(STORAGE_KEY, String(speed));
}

export function formatPracticeSpeed(speed: PracticeSpeed): string {
  return speed === 1 ? "100%" : `${Math.round(speed * 100)}%`;
}
