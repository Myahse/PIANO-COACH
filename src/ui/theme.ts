export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "piano-coach-theme";
const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;

let palette: Map<string, string> | null = null;

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function notify(): void {
  palette = null;
  window.dispatchEvent(new CustomEvent("themechange"));
}

export function themePreference(): ThemePreference {
  return readStored();
}

/** "system" removes the attribute so the CSS media query decides. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = isDark() ? "#0c0e13" : "#f5f6f8";
  notify();
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* storage unavailable — still apply for this session */
  }
  applyTheme(preference);
}

export function isDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return Boolean(media?.matches);
}

/** Apply the saved theme before the app renders, and follow OS changes in "system" mode. */
export function initTheme(): void {
  applyTheme(readStored());
  media?.addEventListener("change", () => {
    if (readStored() === "system") applyTheme("system");
  });
}

/** Current value of a CSS colour token (e.g. "--accent") for canvas drawing; cached per theme. */
export function themeColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  palette ??= new Map();
  let value = palette.get(token);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
    palette.set(token, value);
  }
  return value;
}
