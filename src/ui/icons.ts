/**
 * Inline SVG line icons (Lucide-style, 24×24, stroke = currentColor) so they follow
 * text colour and theme. Use `icon(name)` inside template strings.
 */
const PATHS = {
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  skipBack: '<path d="M18 5 8 12l10 7z"/><path d="M6 5v14"/>',
  skipForward: '<path d="m6 5 10 7-10 7z"/><path d="M18 5v14"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  note: '<circle cx="8" cy="18" r="3"/><path d="M11 18V4l7 3"/>',
  course: '<path d="M2 10 12 5l10 5-10 5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 6v7M12 6v7M17 6v7"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  trophy:
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  flame:
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3.4 1.4 1.4 2.6 2.5 2.8z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Filled variants read better at small sizes for these glyphs. */
const FILLED = new Set<IconName>(["play", "pause", "star"]);

export function icon(name: IconName, className = "icon"): string {
  const fill = FILLED.has(name) ? "currentColor" : "none";
  return `<svg class="${className}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Three-star rating as icons; earned stars are filled, the rest outlined. */
export function starIcons(stars: number, total = 3): string {
  return Array.from({ length: total }, (_, i) =>
    i < stars ? icon("star", "icon star-on") : icon("star", "icon star-off"),
  ).join("");
}
