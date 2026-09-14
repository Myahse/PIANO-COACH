const STORAGE_KEY = "piano-coach-game-v1";

export type GameState = {
  streak: number;
  lastDay: string;
  xp: number;
};

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function shiftDay(iso: string, days: number): string {
  const stamp = new Date(`${iso}T12:00:00`);
  stamp.setDate(stamp.getDate() + days);
  const month = String(stamp.getMonth() + 1).padStart(2, "0");
  const day = String(stamp.getDate()).padStart(2, "0");
  return `${stamp.getFullYear()}-${month}-${day}`;
}

export function loadGame(): GameState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { streak: 0, lastDay: "", xp: 0 };
    const parsed = JSON.parse(raw) as GameState;
    return {
      streak: Number(parsed.streak) || 0,
      lastDay: typeof parsed.lastDay === "string" ? parsed.lastDay : "",
      xp: Number(parsed.xp) || 0,
    };
  } catch {
    return { streak: 0, lastDay: "", xp: 0 };
  }
}

export function lessonXp(stars: number, firstClear: boolean): number {
  return Math.max(1, stars) * 10 + (firstClear ? 15 : 5);
}

export function awardPractice(xp: number): GameState {
  const game = loadGame();
  const day = today();
  if (game.lastDay !== day) {
    game.streak = game.lastDay === shiftDay(day, -1) ? game.streak + 1 : 1;
    game.lastDay = day;
  }
  game.xp += Math.max(0, xp);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  return game;
}
