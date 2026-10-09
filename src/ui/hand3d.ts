import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
/** Time constant of the hands' movement between poses, in seconds. */
const GLIDE = 0.055;

const DIGITS = ["thumb", "index-finger", "middle-finger", "ring-finger", "pinky-finger"] as const;
const CHAIN: Record<(typeof DIGITS)[number], string[]> = {
  thumb: ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
  "index-finger": ["index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
  "middle-finger": ["middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
  "ring-finger": ["ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
  "pinky-finger": ["pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
};

const UP = new THREE.Vector3(0, 1, 0);
const SKIN = 0xe9b796;

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

type Rig = {
  side: HandSide;
  root: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
  bones: Map<string, THREE.Object3D>;
  restPos: Map<string, THREE.Vector3>;
  restQuat: Map<string, THREE.Quaternion>;
  /** Rest-pose bone frames (forward along the bone, back of the hand up), in model space. */
  restFrame: Map<string, THREE.Quaternion>;
  /** Model → keyboard rotation: fingers point up the screen, back of the hand toward the viewer. */
  toWorld: THREE.Quaternion;
  fromWorld: THREE.Quaternion;
  /** Mean rest position of the four knuckles, in model space. */
  knuckleCentre: THREE.Vector3;
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
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6a58, 1.5));
    this.light = new THREE.DirectionalLight(0xfff4ea, 2.2);
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
  static async create(): Promise<Hands3D | null> {
    try {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const base = import.meta.env.BASE_URL ?? "/";
      const loader = new GLTFLoader();
      const [left, right] = await Promise.all(
        (["left", "right"] as const).map(async (side) => buildRig(side, await loader.loadAsync(`${base}models/hands/${side}.glb`))),
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
    this.camera.updateProjectionMatrix();

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

  /** Fingertip targets and hand placement for one hand, in keyboard pixels. */
  private targetPose(input: Hand3DInput): Pose {
    const s = this.scale;
    const H = this.height;
    const byFinger = new Map(input.fingers.map((t) => [t.finger, t]));
    const keyZ = (t: FingerTarget) => (t.onBlack ? 0.4 : 0.66) * H;
    const pressed = input.fingers.filter((t) => t.pressed && t.finger !== 1);
    // The hand sits where its playing fingers are (or over the white keys when resting).
    const refZ = pressed.length ? pressed.reduce((sum, t) => sum + keyZ(t), 0) / pressed.length : 0.66 * H;
    const fingersX = [2, 3, 4, 5].map((n) => byFinger.get(n as 1 | 2 | 3 | 4 | 5)!.x);
    const knuckles = new THREE.Vector3(
      fingersX.reduce((sum, x) => sum + x, 0) / 4,
      KNUCKLE_HEIGHT * s,
      Math.min(refZ + KNUCKLE_REACH * s, H + 0.06 * s),
    );
    const tips = [1, 2, 3, 4, 5].map((n) => {
      const t = byFinger.get(n as 1 | 2 | 3 | 4 | 5)!;
      // Shorter fingers reach less far up the keys; the thumb rests on the front of its key.
      const shorter = n === 1 ? 0.018 : n === 5 ? 0.012 : n === 3 ? -0.004 : 0;
      if (t.pressed) {
        const z = n === 1 && !t.onBlack ? Math.max(keyZ(t), refZ) + 0.012 * s : keyZ(t);
        return new THREE.Vector3(t.x, (t.onBlack ? BLACK_KEY_HEIGHT : 0) * s - KEY_DIP * s, z);
      }
      return new THREE.Vector3(t.x, HOVER * s + (t.onBlack ? BLACK_KEY_HEIGHT * s : 0), refZ + shorter * s);
    });
    const pressedFingers = [1, 2, 3, 4, 5].map((n) => byFinger.get(n as 1 | 2 | 3 | 4 | 5)!.pressed);
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
        c.knuckles.lerp(t.knuckles, k);
        c.tips.forEach((tip, i) => tip.lerp(t.tips[i]!, k));
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
    const s = this.scale;
    // Hand placement: knuckles where the pose wants them.
    const offset = rig.knuckleCentre.clone().applyQuaternion(rig.toWorld).multiplyScalar(s);
    rig.root.position.copy(pose.knuckles).sub(offset);
    rig.root.quaternion.copy(rig.toWorld);
    rig.root.scale.setScalar(s);
    // A resting hand is a touch dimmer than a playing one (kept opaque: see-through skin looks ghostly).
    rig.material.color.setHex(SKIN).multiplyScalar(0.86 + 0.14 * pose.activity);

    const toModel = (p: THREE.Vector3) => p.clone().sub(rig.root.position).divideScalar(s).applyQuaternion(rig.fromWorld);
    const toWorld = (p: THREE.Vector3) => p.clone().applyQuaternion(rig.toWorld).multiplyScalar(s).add(rig.root.position);

    DIGITS.forEach((digit, i) => {
      const names = CHAIN[digit];
      const restPoints = names.map((n) => rig.restPos.get(n)!);
      const lengths = [0, 1, 2].map((j) => restPoints[j]!.distanceTo(restPoints[j + 1]!) * s);
      const points = bendFinger(toWorld(restPoints[0]!), pose.tips[i]!, lengths);
      const heading = new THREE.Vector3(points[3]!.x - points[0]!.x, 0, points[3]!.z - points[0]!.z);
      if (heading.lengthSq() < 1e-9) heading.set(0, 0, -1);
      const lateral = new THREE.Vector3().crossVectors(UP, heading.normalize());
      names.forEach((name, j) => {
        const bone = rig.bones.get(name)!;
        const seg = Math.min(j, 2);
        const forward = points[seg + 1]!.clone().sub(points[seg]!).normalize();
        const back = new THREE.Vector3().crossVectors(forward, lateral);
        // New frame in model space, relative to the bone's rest frame.
        const fm = forward.clone().applyQuaternion(rig.fromWorld);
        const bm = back.clone().applyQuaternion(rig.fromWorld);
        const delta = frame(fm, bm).multiply(rig.restFrame.get(name)!.clone().invert());
        bone.quaternion.copy(delta.multiply(rig.restQuat.get(name)!));
        bone.position.copy(toModel(points[j]!));
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

function buildRig(side: HandSide, gltf: { scene: THREE.Object3D }): Rig {
  const root = gltf.scene;
  const bones = new Map<string, THREE.Object3D>();
  const restPos = new Map<string, THREE.Vector3>();
  const restQuat = new Map<string, THREE.Quaternion>();
  const material = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.58, metalness: 0 });
  root.traverse((node) => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) {
      const mesh = node as THREE.SkinnedMesh;
      mesh.material = material;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    }
    if ((node as THREE.Bone).isBone || /^(wrist|thumb|index|middle|ring|pinky)/.test(node.name)) {
      bones.set(node.name, node);
      restPos.set(node.name, node.position.clone());
      restQuat.set(node.name, node.quaternion.clone());
    }
  });
  // The model's back of the hand faces +x (right hand) or −x (left hand, a mirror image);
  // fingers point along −y and the little finger is toward +z.
  const back = new THREE.Vector3(side === "right" ? 1 : -1, 0, 0);
  const restFrame = new Map<string, THREE.Quaternion>();
  for (const names of Object.values(CHAIN)) {
    names.forEach((name, j) => {
      const seg = Math.min(j, 2);
      const forward = restPos.get(names[seg + 1]!)!.clone().sub(restPos.get(names[seg]!)!);
      restFrame.set(name, frame(forward, back));
    });
  }
  // Model → keyboard: fingers (−y) point up the screen (−z), the back of the hand faces the
  // viewer (+y), and the little finger is to the right for the right hand, left for the left.
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, side === "right" ? 1 : -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(side === "right" ? 1 : -1, 0, 0),
  );
  const toWorld = new THREE.Quaternion().setFromRotationMatrix(m);
  const knuckleCentre = new THREE.Vector3();
  for (const digit of DIGITS.slice(1)) knuckleCentre.add(restPos.get(CHAIN[digit][0]!)!);
  knuckleCentre.divideScalar(4);
  return {
    side,
    root,
    material,
    bones,
    restPos,
    restQuat,
    restFrame,
    toWorld,
    fromWorld: toWorld.clone().invert(),
    knuckleCentre,
    current: null,
    target: null,
    visible: false,
  };
}
