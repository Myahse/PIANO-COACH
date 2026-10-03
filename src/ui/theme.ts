const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;

let palette: Map<string, string> | null = null;

export function isDark(): boolean {
  return Boolean(media?.matches);
}

function syncThemeColorMeta(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = isDark() ? "#0c0e13" : "#f5f6f8";
}

/**
 * The app follows the device's light/dark setting (CSS prefers-color-scheme).
 * When the device switches, canvases are told to repaint with the new palette.
 */
export function initTheme(): void {
  syncThemeColorMeta();
  media?.addEventListener("change", () => {
    palette = null;
    syncThemeColorMeta();
    window.dispatchEvent(new CustomEvent("themechange"));
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
