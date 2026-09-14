import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON =
  process.env.PIANO_COACH_PYTHON ?? "C:\\piano-coach-muscriptor\\venv\\Scripts\\python.exe";
const SCRIPT =
  process.env.PIANO_COACH_MUSCRIPTOR_SCRIPT ??
  path.join(ROOT, "scripts", "transcribe-muscriptor.py");
const MODEL = process.env.PIANO_COACH_MUSCRIPTOR_MODEL ?? "large";
const FAST =
  process.env.PIANO_COACH_MUSCRIPTOR_FAST != null &&
  !/^(0|false|no|off)$/i.test(process.env.PIANO_COACH_MUSCRIPTOR_FAST);
let cachedDevice = null;

function modelWeightsCached(model) {
  const dir = path.join(
    os.homedir(),
    ".cache",
    "huggingface",
    "hub",
    `models--MuScriptor--muscriptor-${model}`,
    "snapshots",
  );
  if (!existsSync(dir)) return false;
  try {
    for (const snap of readdirSync(dir)) {
      if (existsSync(path.join(dir, snap, "model.safetensors"))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
let workerProc = null;
/** @type {Promise<void> | null} */
let workerReady = null;
/** @type {(() => void) | null} */
let resolveWorkerReady = null;
/** @type {Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: number, l?: string) => void }>} */
const pendingJobs = new Map();
let jobId = 0;
let stdoutBuffer = "";

function probeDevice() {
  if (cachedDevice) return Promise.resolve(cachedDevice);
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [
      "-c",
      "import torch; print('cuda' if torch.cuda.is_available() else 'cpu')",
    ]);
    let out = "";
    proc.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    proc.on("close", () => {
      cachedDevice = out.trim() || "cpu";
      resolve(cachedDevice);
    });
    proc.on("error", () => resolve("cpu"));
    setTimeout(() => {
      proc.kill();
      resolve("cpu");
    }, 12_000);
  });
}

function isMuScriptorLogLine(line) {
  const trimmed = line.trim();
  return !trimmed || trimmed.startsWith("[muscriptor]");
}

function parseTranscriptionJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) throw new Error("Empty MuScriptor output");

  const lines = text.split(/\r?\n/).filter((line) => !isMuScriptorLogLine(line));
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const json = JSON.parse(line);
      if (json.error) throw new Error(formatMuScriptorError(json.error));
      if (json.engine || Array.isArray(json.voiceNotes) || Array.isArray(json.instNotes)) {
        return json;
      }
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }

  for (const marker of ['{"engine"', '{"error"']) {
    const idx = text.lastIndexOf(marker);
    if (idx < 0) continue;
    const json = JSON.parse(text.slice(idx));
    if (json.error) throw new Error(formatMuScriptorError(json.error));
    return json;
  }

  throw new Error("No transcription JSON in MuScriptor output");
}

function formatMuScriptorError(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "MuScriptor transcription failed.";

  try {
    const json = JSON.parse(trimmed);
    if (json.error) return formatMuScriptorError(json.error);
    if (typeof json.progress === "number") return "MuScriptor transcription failed.";
  } catch {
    /* not a single JSON payload */
  }

  const message = trimmed
    .split(/\r?\n/)
    .filter((line) => {
      if (isMuScriptorLogLine(line)) return false;
      try {
        const o = JSON.parse(line.trim());
        return typeof o.progress !== "number";
      } catch {
        return Boolean(line.trim());
      }
    })
    .join("\n")
    .trim();

  if (/gated|ModelDownloadError|403|cannot download.*HuggingFace/i.test(message)) {
    return (
      "MuScriptor model access required. Log in with hf auth login, then accept the license at " +
      "https://huggingface.co/MuScriptor/muscriptor-large and retry."
    );
  }

  return message || "MuScriptor transcription failed.";
}

function parseScriptFailure(stdout, stderr) {
  const out = stdout.trim();
  if (out) {
    try {
      const json = JSON.parse(out);
      if (json.error) return formatMuScriptorError(json.error);
    } catch {
      /* stdout was not JSON */
    }
  }
  return formatMuScriptorError(stderr || out);
}

function dispatchWorkerLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    if (msg.ready) {
      resolveWorkerReady?.();
      resolveWorkerReady = null;
      return;
    }
    if (typeof msg.progress === "number") {
      for (const job of pendingJobs.values()) {
        job.onProgress?.(msg.progress, msg.label);
      }
      return;
    }
    const first = pendingJobs.values().next().value;
    if (!first) return;
    const id = pendingJobs.keys().next().value;
    pendingJobs.delete(id);
    if (msg.error) first.reject(new Error(formatMuScriptorError(msg.error)));
    else first.resolve(msg);
  } catch {
    /* ignore partial / non-json stdout */
  }
}

function flushWorkerStdout() {
  let idx;
  while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.slice(0, idx);
    stdoutBuffer = stdoutBuffer.slice(idx + 1);
    dispatchWorkerLine(line);
  }
}

function ensureWorker() {
  if (workerProc && !workerProc.killed) return workerReady ?? Promise.resolve();

  workerReady = new Promise((resolve, reject) => {
    resolveWorkerReady = resolve;
    const args = [SCRIPT, "--worker", "--model", MODEL];
    if (FAST) args.push("--fast");
    else args.push("--no-fast");

    workerProc = spawn(PYTHON, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    stdoutBuffer = "";

    workerProc.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      flushWorkerStdout();
    });

    workerProc.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (typeof msg.progress === "number") {
            for (const job of pendingJobs.values()) {
              job.onProgress?.(msg.progress, msg.label);
            }
          }
        } catch {
          /* stderr log line */
        }
      }
    });

    workerProc.on("error", (err) => {
      workerProc = null;
      workerReady = null;
      resolveWorkerReady = null;
      reject(err);
    });

    workerProc.on("close", (code) => {
      workerProc = null;
      workerReady = null;
      resolveWorkerReady = null;
      for (const [id, job] of pendingJobs) {
        pendingJobs.delete(id);
        job.reject(new Error(`MuScriptor worker exited (${code ?? "unknown"})`));
      }
    });

    // Model load can take several minutes even after download; never abort early.
  });

  return workerReady;
}

function runViaWorker(inPath, target, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    pendingJobs.set(id, { resolve, reject, onProgress });

    const payload = JSON.stringify({ audio: inPath, target, fast: FAST }) + "\n";
    workerProc.stdin.write(payload, (err) => {
      if (err) {
        pendingJobs.delete(id);
        reject(err);
      }
    });
  });
}

function runMuScriptorOneShot(inPath, target, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [SCRIPT, inPath, "--target", target, "--model", MODEL];
    if (FAST) args.push("--fast");
    else args.push("--no-fast");

    const proc = spawn(PYTHON, args, { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    proc.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      err += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (typeof msg.progress === "number") onProgress?.(msg.progress, msg.label);
        } catch {
          /* stderr log line */
        }
      }
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(parseScriptFailure(out, err)));
        return;
      }
      try {
        resolve(parseTranscriptionJson(out));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON from MuScriptor";
        reject(new Error(message));
      }
    });
  });
}

async function runMuScriptor(inPath, target, onProgress) {
  // Only use the persistent worker once weights are cached — otherwise a worker
  // plus one-shot fallback both download the 5.5 GB file and stall for 30+ min.
  if (modelWeightsCached(MODEL)) {
    try {
      await ensureWorker();
      return await runViaWorker(inPath, target, onProgress);
    } catch (error) {
      console.warn("[muscriptor] worker failed, using one-shot:", error);
    }
  }
  return runMuScriptorOneShot(inPath, target, onProgress);
}

function stopWorker() {
  if (workerProc && !workerProc.killed) {
    try {
      workerProc.stdin.write('{"cmd":"shutdown"}\n');
    } catch {
      workerProc.kill();
    }
  }
}

/** Dev-server API: POST /api/muscriptor?filename=song.mp3 → transcription JSON */
export function muscriptorApiPlugin() {
  return {
    name: "muscriptor-api",
    configureServer(server) {
      server.httpServer?.on("close", stopWorker);

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/api/muscriptor/status") {
          const device = await probeDevice();
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              available: existsSync(PYTHON) && existsSync(SCRIPT),
              python: PYTHON,
              script: SCRIPT,
              model: MODEL,
              fast: FAST,
              modelCached: modelWeightsCached(MODEL),
              device,
            }),
          );
          return;
        }

        if (url.pathname !== "/api/muscriptor" || req.method !== "POST") {
          next();
          return;
        }

        if (!existsSync(PYTHON) || !existsSync(SCRIPT)) {
          res.statusCode = 503;
          res.end("MuScriptor is not installed. Run scripts/setup-muscriptor.ps1");
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const audio = Buffer.concat(chunks);
          const filename = path.basename(url.searchParams.get("filename") || "upload.mp3");
          const target = url.searchParams.get("target") || "both";
          const tmp = path.join(os.tmpdir(), "piano-coach-muscriptor");
          await fs.mkdir(tmp, { recursive: true });
          const inPath = path.join(tmp, `in-${Date.now()}-${filename}`);
          await fs.writeFile(inPath, audio);
          res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders?.();
          res.write(`${JSON.stringify({ progress: 6, label: "Processing Audio · starting MuScriptor" })}\n`);
          const result = await runMuScriptor(inPath, target, (progress, label) => {
            if (!res.writableEnded) res.write(`${JSON.stringify({ progress, label })}\n`);
          });
          res.write(`${JSON.stringify(result)}\n`);
          res.end();
          fs.unlink(inPath).catch(() => {});
        } catch (error) {
          const message = error instanceof Error ? error.message : "MuScriptor transcription failed";
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end(message);
          } else {
            res.write(`${JSON.stringify({ error: message })}\n`);
            res.end();
          }
        }
      });
    },
  };
}
