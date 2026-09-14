import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRANSKUN =
  process.env.PIANO_COACH_TRANSKUN ?? "C:\\piano-coach-transkun\\venv\\Scripts\\transkun.exe";
const PYTHON =
  process.env.PIANO_COACH_PYTHON ?? "C:\\piano-coach-transkun\\venv\\Scripts\\python.exe";
const LAYERS_SCRIPT = path.join(ROOT, "scripts", "transcribe-layers.py");

function runTranskun(inPath, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(TRANSKUN, [inPath, outPath, "--device", "cpu"], { windowsHide: true });
    let err = "";
    proc.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(err.trim() || `Transkun exited with code ${code}`));
    });
  });
}

function runLayersScript(inPath, target) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [LAYERS_SCRIPT, inPath, "--target", target], { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    proc.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || out.trim() || `transcribe-layers exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        reject(new Error(out.trim() || "Invalid JSON from transcribe-layers"));
      }
    });
  });
}

/** Dev-server API: POST /api/transkun?filename=song.mp3 → MIDI bytes */
export function transkunApiPlugin() {
  return {
    name: "transkun-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (url.pathname === "/api/transkun/status") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ available: existsSync(TRANSKUN), path: TRANSKUN }));
          return;
        }

        if (url.pathname === "/api/transcribe-layers/status") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              available: existsSync(TRANSKUN) && existsSync(PYTHON) && existsSync(LAYERS_SCRIPT),
            }),
          );
          return;
        }

        if (url.pathname === "/api/transcribe-layers" && req.method === "POST") {
          if (!existsSync(TRANSKUN) || !existsSync(LAYERS_SCRIPT)) {
            res.statusCode = 503;
            res.end("Layered transcription is not installed. Run scripts/setup-python-transkun.ps1");
            return;
          }
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const audio = Buffer.concat(chunks);
            const filename = path.basename(url.searchParams.get("filename") || "upload.mp3");
            const target = url.searchParams.get("target") || "both";
            const tmp = path.join(os.tmpdir(), "piano-coach-layers");
            await fs.mkdir(tmp, { recursive: true });
            const inPath = path.join(tmp, `in-${Date.now()}-${filename}`);
            await fs.writeFile(inPath, audio);
            const result = await runLayersScript(inPath, target);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
            fs.unlink(inPath).catch(() => {});
          } catch (error) {
            res.statusCode = 500;
            res.end(error instanceof Error ? error.message : "Layered transcription failed");
          }
          return;
        }

        if (url.pathname !== "/api/transkun" || req.method !== "POST") {
          next();
          return;
        }

        if (!existsSync(TRANSKUN)) {
          res.statusCode = 503;
          res.end("Transkun Python is not installed. Run scripts/setup-python-transkun.ps1");
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const audio = Buffer.concat(chunks);
          const filename = path.basename(url.searchParams.get("filename") || "upload.mp3");
          const tmp = path.join(os.tmpdir(), "piano-coach-transkun");
          await fs.mkdir(tmp, { recursive: true });
          const id = `${Date.now()}`;
          const inPath = path.join(tmp, `in-${id}-${filename}`);
          const outPath = path.join(tmp, `out-${id}.mid`);
          await fs.writeFile(inPath, audio);

          await runTranskun(inPath, outPath);
          const mid = await fs.readFile(outPath);
          res.setHeader("Content-Type", "audio/midi");
          res.end(mid);

          fs.unlink(inPath).catch(() => {});
          fs.unlink(outPath).catch(() => {});
        } catch (error) {
          res.statusCode = 500;
          res.end(error instanceof Error ? error.message : "Transkun conversion failed");
        }
      });
    },
  };
}
