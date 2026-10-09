import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { HandSide } from "./fingering";
import type { FingerTarget } from "./handArt";

/** One hand to show: where each fingertip goes, as for the illustrated hands. */
export type Hand3DInput = { side: HandSide; fingers: FingerTarget[]; active: boolean };

/** Where a playing finger's number badge goes, in keyboard pixels. */
export type FingerBadge = { side: HandSide; finger: number; x: number; y: number };

/** A real white key is 23.5 mm wide: the hands are drawn to scale with the keys. */
const WHITE_KEY_M = 0.0235;
/** Heights above the white keys' surface, in metres. */
const KNUCKLE_HEIGHT = 0.042;
const BLACK_KEY_HEIGHT = 0.012;
const KEY_DIP = 0.004;
const HOVER = 0.012;
/** How far back from the fingertips the knuckles sit when the hand is curved over the keys. */
const KNUCKLE_REACH = 0.05;
/**
 * The hands are drawn as a player sees them, from in front and above rather than straight down:
 * anything above the keys shifts up the screen by this much per unit of height, so the back of
 * the hand shows over the keys. The keys' surface itself stays exactly where it is on screen.
 */
const VIEW_SLANT = 0.5;
/** Time constant of the hands' movement between poses, in seconds. */
const GLIDE = 0.055;
/** Time constant of a finger pressing or lifting off a key. */
const PRESS = 0.03;

/** Real distance from the index knuckle to the little-finger knuckle, used to size any model. */
const KNUCKLE_SPAN_M = 0.0586;

/** Which hand model to draw. */
export type HandModelId = "webxr" | "game" | "natural";

type HandModel = {
  /** Model file for each hand; one file can serve both (it is mirrored for the other hand). */
  files: Record<HandSide, string>;
  /** Which hand each file shows. */
  shows: Record<HandSide, HandSide>;
  /** Joint names along each digit, thumb → little finger, from the joint the digit bends at to the tip. */
  chains: Chains;
  /** Paint the model in this skin tone (for untextured models); otherwise keep its own skin textures. */
  skin?: number;
};
type Chains = string[][];

const HAND_MODELS: Record<HandModelId, HandModel> = {
  // WebXR Input Profiles "generic-hand" (MIT): untextured, one file per hand.
  webxr: {
    files: { left: "models/hands/left.glb", right: "models/hands/right.glb" },
    shows: { left: "left", right: "right" },
    chains: [
      ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
      ...["index-finger", "middle-finger", "ring-finger", "pinky-finger"].map((d) => [
        `${d}-phalanx-proximal`,
        `${d}-phalanx-intermediate`,
        `${d}-phalanx-distal`,
        `${d}-tip`,
      ]),
    ],
    skin: 0xe9b796,
  },
  // "Rigged hand - Game model" by Lorenzo Drago (Sketchfab): textured skin, one right hand.
  game: {
    files: { left: "models/hands/game/hand.glb", right: "models/hands/game/hand.glb" },
    shows: { left: "right", right: "right" },
    chains: [
      ["Bone.003_014", "Bone.004_015", "Bone.005_016", "Bone.005_end_021"],
      ["Bone.009_02", "Bone.010_03", "Bone.011_04", "Bone.011_end_017"],
      ["Bone.012_05", "Bone.013_06", "Bone.014_07", "Bone.014_end_018"],
      ["Bone.015_08", "Bone.016_09", "Bone.017_010", "Bone.017_end_019"],
      ["Bone.018_011", "Bone.019_012", "Bone.020_013", "Bone.020_end_020"],
    ],
  },
  // "Hand animation test" by SantosGabriel (Sketchfab, CC BY 4.0): textured skin, one hand.
  natural: {
    files: { left: "models/hands/natural/hand.glb", right: "models/hands/natural/hand.glb" },
    shows: { left: "right", right: "right" },
    chains: [
      ["DIR_Jnt_MtCarp_Dedao_022", "DIR_Jnt_Flng01_Dedao_023", "DIR_Jnt_Flng02_Dedao_024", "DIR_Jnt_Flng03_Dedao_025"],
      ["DIR_Jnt_Flng01_Ind_018", "DIR_Jnt_Flng02_Ind_019", "DIR_Jnt_Flng03_Ind_020", "DIR_Jnt_Flng04_Ind_021"],
      ["DIR_Jnt_Flng01_Meio_013", "DIR_Jnt_Flng02_Meio_014", "DIR_Jnt_Flng03_Meio_015", "DIR_Jnt_Flng04_Meio_016"],
      ["DIR_Jnt_Flng01_Anelar_08", "DIR_Jnt_Flng02_Anelar_09", "DIR_Jnt_Flng03_Anelar_010", "DIR_Jnt_Flng04_Anelar_011"],
      ["DIR_Jnt_Flng01_Mind_03", "DIR_Jnt_Flng02_Mind_04", "DIR_Jnt_Flng03_Mind_05", "DIR_Jnt_Flng04_Mind_06"],
    ],
  },
};

const UP = new THREE.Vector3(0, 1, 0);

type Pose = {
  /** Mean knuckle position of the four fingers, in keyboard pixels (x across, y up, z down the screen). */
  knuckles: THREE.Vector3;
  /** Fingertip targets, thumb → little finger. */
  tips: THREE.Vector3[];
  /** Which fingers (thumb → little finger) are playing. */
  pressed: boolean[];
  /** 1 while the hand plays, 0 at rest (rest is drawn slightly dimmer). */
  activity: number;
};

/** A bone's rest pose in model space (the loaded file's own coordinates). */
type Rest = { matrix: THREE.Matrix4; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 };

type Rig = {
  side: HandSide;
  /** Places the model on the keyboard (its matrix is set directly: it may mirror the model). */
  root: THREE.Object3D;
  chains: Chains;
  materials: THREE.MeshStandardMaterial[];
  /** Base colour the resting/playing shading multiplies. */
  tint: THREE.Color;
  bones: Map<string, THREE.Object3D>;
  rest: Map<THREE.Object3D, Rest>;
  /** Rest-pose bone frames (forward along the bone, back of the hand up), in model space. */
  restFrame: Map<string, THREE.Quaternion>;
  /** Model → keyboard axes: fingers up the screen, back of the hand toward the viewer. */
  toWorld: THREE.Matrix3;
  fromWorld: THREE.Matrix3;
  /** Metres per model unit. */
  unit: number;
  /** Mean rest position of the four knuckles, in model space. */
  knuckleCentre: THREE.Vector3;
  /** Where each relaxed fingertip falls across the keyboard, from the knuckles' centre (model units). */
  naturalX: number[];
  current: Pose | null;
  target: Pose | null;
  visible: boolean;
};

/** Rotation whose columns are forward, up and their cross product. */
function frame(forward: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const f = forward.clone().normalize();
  const u = up.clone().sub(f.clone().multiplyScalar(up.dot(f))).normalize();
  const side = new THREE.Vector3().crossVectors(f, u);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, u, side));
}

/**
 * Bend one finger so its tip lands on `target`: the knuckle stays put, the finger turns toward
 * the target and its joints flex in a natural curve (the end joint follows the middle one, as
 * in a real finger). Returns the joint positions, knuckle → tip.
 */
export function bendFinger(base: THREE.Vector3, target: THREE.Vector3, lengths: number[]): THREE.Vector3[] {
  const flat = new THREE.Vector3(target.x - base.x, 0, target.z - base.z);
  const r = flat.length();
  const heading = r > 1e-6 ? flat.divideScalar(r) : new THREE.Vector3(0, 0, -1);
  const h = target.y - base.y;
  const total = lengths.reduce((s, l) => s + l, 0);
  const tipAt = (a: number, b: number) => {
    const angles = [a, a + b, a + b + 0.75 * b];
    let x = 0;
    let y = 0;
    angles.forEach((phi, i) => {
      x += lengths[i]! * Math.cos(phi);
      y -= lengths[i]! * Math.sin(phi);
    });
    return { x, y, angles };
  };
  const cost = (a: number, b: number) => {
    const t = tipAt(a, b);
    // Reach the target; among ways to do it, prefer a pianist's rounded finger.
    return ((t.x - r) ** 2 + (t.y - h) ** 2) / (total * total) + 0.003 * (b - (0.9 * a + 0.35)) ** 2;
  };
  let best = { a: 0.3, b: 0.6, c: Infinity };
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const a = -0.4 + (1.9 * i) / 20;
      const b = (1.9 * j) / 20;
      const c = cost(a, b);
      if (c < best.c) best = { a, b, c };
    }
  }
  for (let step = 0.05; step > 0.002; step /= 2) {
    for (let moved = true; moved; ) {
      moved = false;
      for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
        const a = Math.max(-0.4, best.a + da);
        const b = Math.min(1.9, Math.max(0, best.b + db));
        const c = cost(a, b);
        if (c < best.c - 1e-12) {
          best = { a, b, c };
          moved = true;
        }
      }
    }
  }
  const { angles } = tipAt(best.a, best.b);
  const points = [base.clone()];
  angles.forEach((phi, i) => {
    const step = heading.clone().multiplyScalar(Math.cos(phi) * lengths[i]!).addScaledVector(UP, -Math.sin(phi) * lengths[i]!);
    points.push(points[i]!.clone().add(step));
  });
  return points;
}

/**
 * Realistic guide hands: a rigged 3D hand model (the MIT-licensed WebXR generic hands), posed with
 * a small inverse-kinematics solver so each finger curves down onto its key, lit, and drawn over
 * the keyboard from above at the keys' true scale, with soft shadows on the keys.
 */
export class Hands3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 20000);
  private light: THREE.DirectionalLight;
  private shadowCatcher: THREE.Mesh;
  private rigs: Record<HandSide, Rig>;
  private width = 1;
  private height = 1;
  private scale = 1;
  private frameRequest = 0;
  private lastFrame = 0;
  /** Called after each frame with where the playing fingers' badges go. */
  onBadges: ((badges: FingerBadge[]) => void) | null = null;

  private constructor(renderer: THREE.WebGLRenderer, rigs: Record<HandSide, Rig>) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.className = "hands-3d";
    this.rigs = rigs;

    this.camera.up.set(0, 0, -1);
    // Soft studio reflections, a low ambient fill, a key light from above-left that rakes across
    // the skin (bringing out knuckles and veins), and a warm back light for the glow at the edges
    // of skin that light shines through.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xfff6ee, 0x7a5040, 0.35));
    const rake = new THREE.DirectionalLight(0xfff4ec, 1.9);
    rake.position.set(-0.8, 0.55, -0.45);
    const rim = new THREE.DirectionalLight(0xffa080, 0.55);
    rim.position.set(0.2, 0.25, 1);
    this.scene.add(rake, rim);
    this.light = new THREE.DirectionalLight(0xfff4ea, 1.5);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 1024);
    this.light.shadow.radius = 4;
    this.scene.add(this.light, this.light.target);
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);
    for (const rig of Object.values(rigs)) this.scene.add(rig.root);
  }

  /** Load the hand models and set up WebGL; null if this device cannot draw them. */
  static async create(modelId: HandModelId = "natural"): Promise<Hands3D | null> {
    try {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      const base = import.meta.env.BASE_URL ?? "/";
      const loader = new GLTFLoader();
      const model = HAND_MODELS[modelId];
      const [left, right] = await Promise.all(
        (["left", "right"] as const).map(async (side) => buildRig(side, await loader.loadAsync(`${base}${model.files[side]}`), model)),
      );
      return new Hands3D(renderer, { left: left!, right: right! });
    } catch (error) {
      console.warn("3D hands unavailable", error);
      return null;
    }
  }

  /** Match the keyboard's size on screen; `whiteW` sets the hands' scale. */
  setSize(width: number, height: number, whiteW: number): void {
    if (width === this.width && height === this.height && Math.abs(whiteW / WHITE_KEY_M - this.scale) < 1e-6) return;
    this.width = width;
    this.height = height;
    this.scale = whiteW / WHITE_KEY_M;
    this.renderer.setSize(width, height, false);
    Object.assign(this.camera, { left: 0, right: width, top: 0, bottom: -height });
    this.camera.position.set(0, 4000, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    // Slant the view: a world shear z' = z − VIEW_SLANT·y folded into the projection.
    const shear = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, -VIEW_SLANT, 1, 0, 0, 0, 0, 1);
    this.camera.projectionMatrix.multiply(this.camera.matrixWorldInverse).multiply(shear).multiply(this.camera.matrixWorld);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    this.shadowCatcher.scale.set(width * 1.5, height * 3, 1);
    this.shadowCatcher.position.set(width / 2, 0, height / 2);
    const s = this.scale;
    this.light.position.set(width / 2 - 0.15 * s, 0.6 * s, height / 2 - 0.25 * s);
    this.light.target.position.set(width / 2, 0, height / 2);
    const cam = this.light.shadow.camera;
    Object.assign(cam, { left: -width * 0.75, right: width * 0.75, top: height * 2, bottom: -height * 2, near: 0.01 * s, far: 2 * s });
    cam.updateProjectionMatrix();
    // Jump straight to the new layout rather than gliding across a resize.
    for (const rig of Object.values(this.rigs)) rig.current = null;
    this.requestFrame();
  }

  /** Move the hands to a new pose; they glide there over a few frames. */
  setHands(hands: Hand3DInput[]): void {
    for (const side of ["left", "right"] as const) {
      const input = hands.find((hand) => hand.side === side);
      const rig = this.rigs[side];
      rig.visible = Boolean(input);
      rig.root.visible = rig.visible;
      if (input) rig.target = this.targetPose(input);
    }
    this.requestFrame();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameRequest);
    this.renderer.dispose();
  }

  /**
   * Fingertip targets and hand placement for one hand, in keyboard pixels.
   *
   * The hand moves as one: it centres itself so the playing fingers reach their keys with the
   * least sideways bend, and the other fingers stay relaxed where they naturally fall — in line
   * with their own knuckles, slightly curled above the keys — instead of being sent to keys.
   */
  private targetPose(input: Hand3DInput): Pose {
    const s = this.scale;
    const H = this.height;
    const rig = this.rigs[input.side];
    const k = s * rig.unit;
    const dir = input.side === "right" ? 1 : -1;
    const byFinger = new Map(input.fingers.map((t) => [t.finger, t]));
    const at = (n: number) => byFinger.get(n as 1 | 2 | 3 | 4 | 5)!;
    const keyZ = (t: FingerTarget) => (t.onBlack ? 0.4 : 0.66) * H;
    // Where each fingertip falls, sideways from the knuckles' centre, in a relaxed hand.
    const natural = rig.naturalX.map((x) => x * k);

    const playing = [1, 2, 3, 4, 5].filter((n) => at(n).pressed);
    const fingersPlaying = playing.filter((n) => n !== 1);
    // Centre the hand on the playing fingers (or where the planner rests it).
    const centreX = playing.length
      ? playing.reduce((sum, n) => sum + at(n).x - natural[n - 1]!, 0) / playing.length
      : [2, 3, 4, 5].reduce((sum, n) => sum + at(n).x, 0) / 4;
    const refZ = fingersPlaying.length ? fingersPlaying.reduce((sum, n) => sum + keyZ(at(n)), 0) / fingersPlaying.length : 0.66 * H;
    const knuckles = new THREE.Vector3(centreX, KNUCKLE_HEIGHT * s, Math.min(refZ + KNUCKLE_REACH * s, H + 0.06 * s));
    // Over the black keys, resting fingers hover above them rather than sinking into them.
    const hover = (HOVER + (refZ < 0.6 * H ? BLACK_KEY_HEIGHT : 0)) * s;

    const tips = [1, 2, 3, 4, 5].map((n) => {
      const t = at(n);
      // Shorter fingers reach less far up the keys; the thumb rests on the front of its key.
      const shorter = n === 1 ? 0.018 : n === 5 ? 0.012 : n === 3 ? -0.004 : 0;
      if (t.pressed) {
        const z = n === 1 && !t.onBlack ? Math.max(keyZ(t), refZ) + 0.012 * s : keyZ(t);
        return new THREE.Vector3(t.x, (t.onBlack ? BLACK_KEY_HEIGHT : 0) * s - KEY_DIP * s, z);
      }
      return new THREE.Vector3(centreX + natural[n - 1]!, hover, refZ + shorter * s);
    });
    // Fingers never cross: a resting finger stays between its neighbours (thumb → little finger
    // run left → right on the right hand, right → left on the left hand).
    const gap = 0.55 * s * WHITE_KEY_M;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < 5; i++) {
        const prev = tips[i - 1]!;
        const tip = tips[i]!;
        if (!at(i + 1).pressed && dir * (tip.x - prev.x) < gap) tip.x = prev.x + dir * gap;
      }
      for (let i = 3; i >= 0; i--) {
        const next = tips[i + 1]!;
        const tip = tips[i]!;
        if (!at(i + 1).pressed && dir * (next.x - tip.x) < gap) tip.x = next.x - dir * gap;
      }
    }
    const pressedFingers = [1, 2, 3, 4, 5].map((n) => at(n).pressed);
    return { knuckles, tips, pressed: pressedFingers, activity: input.active ? 1 : 0 };
  }

  private requestFrame(): void {
    if (this.frameRequest) return;
    this.lastFrame = performance.now();
    this.frameRequest = requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number): void {
    this.frameRequest = 0;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const k = 1 - Math.exp(-dt / GLIDE);
    let moving = false;
    for (const rig of Object.values(this.rigs)) {
      if (!rig.target) continue;
      if (!rig.current) {
        rig.current = clonePose(rig.target);
      } else {
        const c = rig.current;
        const t = rig.target;
        // Fingers move with the hand: blend each fingertip relative to the knuckles, so a hand
        // shift carries all the fingers along instead of each one sweeping across on its own.
        // Pressing and lifting (height) is quicker than travelling.
        const press = 1 - Math.exp(-dt / PRESS);
        const before = c.knuckles.clone();
        c.knuckles.lerp(t.knuckles, k);
        c.tips.forEach((tip, i) => {
          const rel = tip.clone().sub(before);
          const goal = t.tips[i]!.clone().sub(t.knuckles);
          const y = rel.y + (goal.y - rel.y) * press;
          rel.lerp(goal, k);
          rel.y = y;
          tip.copy(c.knuckles).add(rel);
        });
        c.activity += (t.activity - c.activity) * k;
        c.pressed = t.pressed;
        const gap = c.knuckles.distanceTo(t.knuckles) + c.tips.reduce((sum, tip, i) => sum + tip.distanceTo(t.tips[i]!), 0);
        if (gap > 0.3) moving = true;
      }
      this.applyPose(rig, rig.current);
    }
    this.renderer.render(this.scene, this.camera);
    this.onBadges?.(this.badges());
    if (moving) this.requestFrame();
  }

  /** Pose the bones: place the hand, then bend each finger onto its fingertip target. */
  private applyPose(rig: Rig, pose: Pose): void {
    const k = this.scale * rig.unit; // keyboard pixels per model unit
    // Hand placement: knuckles where the pose wants them.
    const origin = pose.knuckles.clone().sub(rig.knuckleCentre.clone().applyMatrix3(rig.toWorld).multiplyScalar(k));
    const e = rig.toWorld.elements;
    rig.root.matrix.set(
      e[0]! * k, e[3]! * k, e[6]! * k, origin.x,
      e[1]! * k, e[4]! * k, e[7]! * k, origin.y,
      e[2]! * k, e[5]! * k, e[8]! * k, origin.z,
      0, 0, 0, 1,
    );
    rig.root.matrixWorldNeedsUpdate = true;
    // A resting hand is a touch dimmer than a playing one (kept opaque: see-through skin looks ghostly).
    for (const material of rig.materials) material.color.copy(rig.tint).multiplyScalar(0.86 + 0.14 * pose.activity);

    const toModel = (p: THREE.Vector3) => p.clone().sub(origin).divideScalar(k).applyMatrix3(rig.fromWorld);
    const toWorld = (p: THREE.Vector3) => p.clone().applyMatrix3(rig.toWorld).multiplyScalar(k).add(origin);

    rig.chains.forEach((names, i) => {
      const bones = names.map((n) => rig.bones.get(n)!);
      const restPoints = bones.map((bone) => rig.rest.get(bone)!.pos);
      const lengths = [0, 1, 2].map((j) => restPoints[j]!.distanceTo(restPoints[j + 1]!) * k);
      const points = bendFinger(toWorld(restPoints[0]!), pose.tips[i]!, lengths);
      const heading = new THREE.Vector3(points[3]!.x - points[0]!.x, 0, points[3]!.z - points[0]!.z);
      if (heading.lengthSq() < 1e-9) heading.set(0, 0, -1);
      const lateral = new THREE.Vector3().crossVectors(UP, heading.normalize());
      // Each bone's new model-space matrix, set relative to its parent (bones may be nested in a
      // chain, or all hang off one root).
      const posed = new Map<THREE.Object3D, THREE.Matrix4>();
      bones.forEach((bone, j) => {
        const seg = Math.min(j, 2);
        const forward = points[seg + 1]!.clone().sub(points[seg]!).normalize();
        const back = new THREE.Vector3().crossVectors(forward, lateral);
        const fm = forward.applyMatrix3(rig.fromWorld);
        const bm = back.applyMatrix3(rig.fromWorld);
        const rest = rig.rest.get(bone)!;
        const delta = frame(fm, bm).multiply(rig.restFrame.get(names[j]!)!.clone().invert());
        const matrix = new THREE.Matrix4().compose(toModel(points[j]!), delta.multiply(rest.quat), rest.scale);
        const parent = posed.get(bone.parent!) ?? rig.rest.get(bone.parent!)?.matrix ?? new THREE.Matrix4();
        new THREE.Matrix4().copy(parent).invert().multiply(matrix).decompose(bone.position, bone.quaternion, bone.scale);
        posed.set(bone, matrix);
      });
    });
  }

  /** Badge spots: just behind each playing fingertip, projected onto the keyboard. */
  private badges(): FingerBadge[] {
    const out: FingerBadge[] = [];
    const s = this.scale;
    for (const rig of Object.values(this.rigs)) {
      if (!rig.visible || !rig.target || !rig.current) continue;
      rig.target.tips.forEach((_, i) => {
        if (!rig.target!.pressed[i]) return;
        const now = rig.current!.tips[i]!;
        out.push({ side: rig.side, finger: i + 1, x: now.x, y: now.z + 0.022 * s });
      });
    }
    return out;
  }
}

function clonePose(pose: Pose): Pose {
  return { ...pose, knuckles: pose.knuckles.clone(), tips: pose.tips.map((t) => t.clone()) };
}

/**
 * A textured skin: the model's own colour, normal and roughness maps on a physical material with a
 * warm sheen, which reads like the reddish glow of light scattering through skin at its edges.
 */
function skinMaterial(source: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone().multiplyScalar(1.4),
    roughnessMap: source.roughnessMap,
    metalnessMap: source.metalnessMap,
    aoMap: source.aoMap,
    roughness: source.roughness,
    metalness: 0,
    color: source.color,
    sheen: 0.3,
    sheenColor: new THREE.Color(0xff9a80),
    sheenRoughness: 0.55,
  });
}

function buildRig(side: HandSide, gltf: { scene: THREE.Object3D }, model: HandModel): Rig {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const chains = model.chains.map((names) => names.map((n) => THREE.PropertyBinding.sanitizeNodeName(n)));
  const wanted = new Set(chains.flat());
  const bones = new Map<string, THREE.Object3D>();
  const materials: THREE.MeshStandardMaterial[] = [];
  const skin = model.skin !== undefined ? new THREE.MeshStandardMaterial({ color: model.skin, roughness: 0.58, metalness: 0 }) : null;
  scene.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
      const mesh = node as THREE.SkinnedMesh;
      if (skin) mesh.material = skin;
      else mesh.material = [mesh.material].flat().map((m) => (m instanceof THREE.MeshStandardMaterial ? skinMaterial(m) : m))[0]!;
      for (const material of [mesh.material].flat()) {
        if (material instanceof THREE.MeshStandardMaterial && !materials.includes(material)) materials.push(material);
      }
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
    if (wanted.has(node.name)) bones.set(node.name, node);
  });
  const missing = [...wanted].filter((name) => !bones.has(name));
  if (missing.length) throw new Error(`hand model is missing joints: ${missing.join(", ")}`);

  // Rest pose of every bone in the digits (and their parents), in model space.
  const rest = new Map<THREE.Object3D, Rest>();
  const remember = (node: THREE.Object3D) => {
    const matrix = node.matrixWorld.clone();
    const r: Rest = { matrix, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
    matrix.decompose(r.pos, r.quat, r.scale);
    rest.set(node, r);
  };
  for (const bone of bones.values()) {
    remember(bone);
    if (bone.parent && !rest.has(bone.parent)) remember(bone.parent);
  }
  const at = (name: string) => rest.get(bones.get(name)!)!.pos;

  // The model's own axes, from its rest pose: fingers point along `forward`, the little finger
  // lies toward `littleward`, and the back of the hand faces littleward × forward for a right
  // hand (the opposite way for a left hand).
  const [, index, middle, , little] = chains;
  const forward = at(middle![1]!).clone().sub(at(middle![0]!)).normalize();
  const littleward = at(little![0]!).clone().sub(at(index![0]!));
  const span = littleward.length();
  littleward.addScaledVector(forward, -littleward.dot(forward)).normalize();
  const back = new THREE.Vector3().crossVectors(littleward, forward);
  if (model.shows[side] === "left") back.negate();

  const restFrame = new Map<string, THREE.Quaternion>();
  for (const names of chains) {
    names.forEach((name, j) => {
      const seg = Math.min(j, 2);
      restFrame.set(name, frame(at(names[seg + 1]!).clone().sub(at(names[seg]!)), back));
    });
  }
  // Model → keyboard: fingers point up the screen (−z), the back of the hand faces the viewer
  // (+y), and the little finger is to the right for the right hand, left for the left. Using a
  // right-hand model for the left hand makes this a mirror image.
  const modelAxes = new THREE.Matrix3().set(
    forward.x, back.x, littleward.x,
    forward.y, back.y, littleward.y,
    forward.z, back.z, littleward.z,
  );
  const keyboardAxes = new THREE.Matrix3().set(0, 0, side === "right" ? 1 : -1, 0, 1, 0, -1, 0, 0);
  const toWorld = keyboardAxes.multiply(modelAxes.clone().transpose());
  const knuckleCentre = new THREE.Vector3();
  for (const names of chains.slice(1)) knuckleCentre.add(at(names[0]!));
  knuckleCentre.divideScalar(4);
  // Relaxed fingers fan out a little beyond their knuckles; the thumb sits about a key's width
  // in from where its middle joint is.
  const across = (p: THREE.Vector3) => p.clone().sub(knuckleCentre).applyMatrix3(toWorld).x;
  const naturalX = chains.map((names, i) => (i === 0 ? across(at(names[2]!)) * 0.85 : across(at(names[0]!)) * 1.1));

  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.add(scene);
  return {
    side,
    root,
    chains,
    materials,
    tint: materials[0]?.color.clone() ?? new THREE.Color(0xffffff),
    bones,
    rest,
    restFrame,
    toWorld,
    fromWorld: toWorld.clone().transpose(),
    unit: KNUCKLE_SPAN_M / span,
    knuckleCentre,
    naturalX,
    current: null,
    target: null,
    visible: false,
  };
}
