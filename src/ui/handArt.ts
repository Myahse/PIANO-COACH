import type { Finger, HandSide } from "./fingering";

/** Where one fingertip is aimed, in keyboard pixels. */
export type FingerTarget = {
  finger: Finger;
  /** Centre of the key (or resting spot) under the fingertip. */
  x: number;
  pressed: boolean;
  onBlack: boolean;
};

export type HandArtInput = {
  side: HandSide;
  /** Five fingers in keyboard order, left → right. */
  fingers: FingerTarget[];
  /** Width of one white key and height of the keyboard, in pixels. */
  whiteW: number;
  height: number;
  /** Is the hand playing right now (otherwise it hovers, faded)? */
  active: boolean;
  /** Colour used for the finger-number badges (matches the falling notes of this hand). */
  accent: string;
};

const SKIN = {
  light: "#f6d3b8",
  base: "#e7b28d",
  shade: "#c98c66",
  line: "#9d6748",
  nail: "#f8e1d6",
  nailEdge: "#d7a48a",
  crease: "#b57a58",
};

type Pt = { x: number; y: number };
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const f = (n: number) => n.toFixed(1);
const p = (a: Pt) => `${f(a.x)} ${f(a.y)}`;

/** Finger widths relative to a white key, base and tip. */
const WIDTH: Record<Finger, { base: number; tip: number }> = {
  1: { base: 0.78, tip: 0.58 },
  2: { base: 0.62, tip: 0.48 },
  3: { base: 0.66, tip: 0.5 },
  4: { base: 0.6, tip: 0.46 },
  5: { base: 0.52, tip: 0.4 },
};

/** Resting fingertip heights: relaxed fingers form an arc — middle finger reaches furthest. */
const REST_Y: Record<Finger, number> = { 1: 0.76, 2: 0.7, 3: 0.67, 4: 0.7, 5: 0.75 };

/** How high each knuckle sits (fraction of keyboard height); the middle finger's is highest. */
const KNUCKLE_Y: Record<Finger, number> = { 1: 1.3, 2: 0.97, 3: 0.95, 4: 0.97, 5: 1.01 };

/**
 * One finger: a tapered, slightly full shape from knuckle to a rounded tip, shaded across its
 * width, with two joint creases and a nail. Returns SVG markup.
 */
function fingerPath(id: string, knuckle: Pt, tip: Pt, baseW: number, tipW: number, pressed: boolean): string {
  const len = Math.hypot(tip.x - knuckle.x, tip.y - knuckle.y) || 1;
  const d = { x: (tip.x - knuckle.x) / len, y: (tip.y - knuckle.y) / len };
  const n = { x: -d.y, y: d.x };
  const hb = baseW / 2;
  const ht = tipW / 2;
  const mid = add(knuckle, scale(d, len * 0.5));
  const bulge = (hb + ht) / 2 + 0.06 * baseW;
  // Outline: knuckle (left) → tip (left) → round tip → tip (right) → knuckle (right).
  const kl = add(knuckle, scale(n, hb));
  const kr = add(knuckle, scale(n, -hb));
  const tl = add(tip, scale(n, ht));
  const tr = add(tip, scale(n, -ht));
  const ml = add(mid, scale(n, bulge));
  const mr = add(mid, scale(n, -bulge));
  const cap1 = add(tl, scale(d, ht * 1.35));
  const cap2 = add(tr, scale(d, ht * 1.35));
  const outline = `M ${p(kl)} Q ${p(ml)} ${p(tl)} C ${p(cap1)} ${p(cap2)} ${p(tr)} Q ${p(mr)} ${p(kr)} Z`;

  // Shading across the finger: darker edges, highlight just off-centre.
  const g0 = add(knuckle, scale(n, hb));
  const g1 = add(knuckle, scale(n, -hb));
  const gradient = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g0.x)}" y1="${f(g0.y)}" x2="${f(g1.x)}" y2="${f(g1.y)}">
      <stop offset="0" stop-color="${SKIN.shade}"/><stop offset="0.35" stop-color="${pressed ? SKIN.light : SKIN.base}"/>
      <stop offset="0.6" stop-color="${SKIN.base}"/><stop offset="1" stop-color="${SKIN.shade}"/></linearGradient>`;

  // Joint creases at the two finger joints.
  const crease = (t: number, w: number) => {
    const c = add(tip, scale(d, -len * t));
    const a = add(c, scale(n, w * 0.55));
    const b = add(c, scale(n, -w * 0.55));
    const ctrl = add(c, scale(d, w * 0.18));
    return `<path d="M ${p(a)} Q ${p(ctrl)} ${p(b)}" fill="none" stroke="${SKIN.crease}" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>`;
  };
  const w1 = ht * 2 + (hb - ht) * 0.5;
  const w2 = ht * 2 + (hb - ht) * 0.9;

  // Nail near the tip, aligned with the finger.
  const nailC = add(tip, scale(d, ht * 0.35));
  const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI + 90;
  const nail = `<ellipse cx="${f(nailC.x)}" cy="${f(nailC.y)}" rx="${f(ht * 0.62)}" ry="${f(ht * 0.95)}"
      transform="rotate(${f(angle)} ${f(nailC.x)} ${f(nailC.y)})" fill="${SKIN.nail}" stroke="${SKIN.nailEdge}" stroke-width="0.8"/>`;

  return `<defs>${gradient}</defs>
    <path d="${outline}" fill="url(#${id})" stroke="${SKIN.line}" stroke-width="1.1" stroke-linejoin="round"/>
    ${crease(0.34, w1)}${crease(0.62, w2)}${nail}`;
}

/**
 * A hand seen from above, as when looking down at your own hands on the keys: fingers reach up
 * from the knuckles onto the keys, the thumb comes in from the side, and the palm runs off the
 * bottom edge toward the player. Returns SVG markup for one hand.
 */
export function handSvg(input: HandArtInput): string {
  const { side, fingers, whiteW: w, height: H, active, accent } = input;
  const right = side === "right";
  const byFinger = new Map(fingers.map((t) => [t.finger, t]));

  // Fingertip heights: a pressed finger reaches into the key (higher up for black keys); a
  // resting finger hovers near the front edge, curled.
  const tipY = (t: FingerTarget) => (t.pressed ? (t.onBlack ? 0.42 : 0.6) : REST_Y[t.finger]) * H;

  // Knuckles follow the fingers but stay close together on the back of the hand.
  const nonThumb = [2, 3, 4, 5].map((n) => byFinger.get(n as Finger)!);
  const centre = nonThumb.reduce((s, t) => s + t.x, 0) / 4;
  const spacing = w * 0.92;
  const order = right ? [2, 3, 4, 5] : [5, 4, 3, 2];
  const knuckles = new Map<Finger, Pt>();
  order.forEach((finger, i) => {
    const slot = centre + (i - 1.5) * spacing;
    const t = byFinger.get(finger as Finger)!;
    knuckles.set(finger as Finger, { x: slot + (t.x - slot) * 0.35, y: KNUCKLE_Y[finger as Finger] * H });
  });
  const index = knuckles.get(2)!;
  const thumbBase = { x: index.x + (right ? 0.35 : -0.35) * spacing, y: KNUCKLE_Y[1] * H };
  knuckles.set(1, thumbBase);

  // Palm: rounded top just under the knuckles, running off the bottom edge.
  const xs = [...knuckles.values()].map((k) => k.x);
  const left = Math.min(...xs) - w * 0.5;
  const rightEdge = Math.max(...xs) + w * 0.5;
  const top = Math.min(...[2, 3, 4, 5].map((n) => knuckles.get(n as Finger)!.y)) - w * 0.15;
  const bottom = H + w * 2;
  const thumbSide = right ? left : rightEdge;
  const pinkySide = right ? rightEdge : left;
  const palm = `M ${f(pinkySide)} ${f(bottom)} L ${f(pinkySide)} ${f(top + w * 0.6)}
      Q ${f(pinkySide)} ${f(top)} ${f((pinkySide + thumbSide) / 2)} ${f(top - w * 0.05)}
      Q ${f(thumbSide)} ${f(top)} ${f(thumbSide - (right ? w * 0.2 : -w * 0.2))} ${f(top + w * 0.9)} L ${f(thumbSide)} ${f(bottom)} Z`;

  const parts: string[] = [];
  parts.push(`<defs><linearGradient id="palm-${side}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${SKIN.base}"/><stop offset="1" stop-color="${SKIN.shade}"/></linearGradient></defs>
    <path d="${palm}" fill="url(#palm-${side})" stroke="${SKIN.line}" stroke-width="1.1"/>`);

  // Thumb first (it sits under the hand's edge), then fingers outward → inward.
  const drawOrder: Finger[] = [1, 5, 4, 2, 3];
  for (const finger of drawOrder) {
    const t = byFinger.get(finger)!;
    const tip = { x: t.x, y: tipY(t) };
    const k = knuckles.get(finger)!;
    const width = WIDTH[finger];
    if (t.pressed) {
      // Soft contact shadow on the key under the fingertip.
      parts.push(`<ellipse cx="${f(tip.x)}" cy="${f(tip.y - w * 0.15)}" rx="${f(w * 0.42)}" ry="${f(w * 0.2)}" fill="rgba(16,24,40,0.22)"/>`);
    }
    parts.push(fingerPath(`f-${side}-${finger}`, k, tip, width.base * w, width.tip * w, t.pressed));
    // Finger number: a coloured badge on the playing finger, a faint number on resting ones.
    const lenVec = sub(k, tip);
    const lenN = Math.hypot(lenVec.x, lenVec.y) || 1;
    const along = add(tip, scale(lenVec, (w * 0.75) / lenN));
    const r = Math.max(6, Math.min(8.5, w * 0.34));
    if (t.pressed) {
      parts.push(`<circle cx="${f(along.x)}" cy="${f(along.y)}" r="${f(r)}" fill="${accent}" stroke="#fff" stroke-width="1.4"/>
        <text x="${f(along.x)}" y="${f(along.y + r * 0.36)}" text-anchor="middle" font-size="${f(r * 1.05)}" font-weight="700" fill="#fff">${finger}</text>`);
    } else {
      parts.push(`<text x="${f(along.x)}" y="${f(along.y + r * 0.36)}" text-anchor="middle" font-size="${f(r * 0.95)}" font-weight="700" fill="${SKIN.line}" opacity="0.65">${finger}</text>`);
    }
  }

  return `<g class="hand-art hand-${side}${active ? " active" : ""}">${parts.join("")}</g>`;
}
