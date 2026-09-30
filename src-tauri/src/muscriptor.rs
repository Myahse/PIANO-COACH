use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const DEFAULT_PYTHON: &str = r"C:\piano-coach-muscriptor\venv\Scripts\python.exe";

struct Worker {
    child: Child,
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);

pub fn python_path() -> PathBuf {
    std::env::var("PIANO_COACH_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_PYTHON))
}

/** Short temp name — avoid Windows MAX_PATH failures on long song titles. */
pub fn temp_audio_path(tmp_dir: &Path, id: &str, original_filename: &str) -> PathBuf {
    let ext = Path::new(original_filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| e.to_ascii_lowercase())
        .filter(|e| {
            matches!(
                e.as_str(),
                "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" | "wma" | "webm"
            )
        })
        .unwrap_or_else(|| "mp3".into());
    tmp_dir.join(format!("in-{id}.{ext}"))
}

fn baked_script_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join("scripts").join(name))
        .unwrap_or_else(|| PathBuf::from("scripts").join(name))
}

pub fn resolve_script(app: &AppHandle, name: &str) -> PathBuf {
    if name == "transcribe-muscriptor.py" {
        if let Ok(p) = std::env::var("PIANO_COACH_MUSCRIPTOR_SCRIPT") {
            return PathBuf::from(p);
        }
    }
    if let Ok(p) = app.path().resolve(
        format!("scripts/{name}"),
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.exists() {
            return p;
        }
    }
    baked_script_path(name)
}

pub fn model_name() -> String {
    std::env::var("PIANO_COACH_MUSCRIPTOR_MODEL").unwrap_or_else(|_| "large".into())
}

pub fn fast_mode() -> bool {
    match std::env::var("PIANO_COACH_MUSCRIPTOR_FAST") {
        Ok(v) => !matches!(v.to_lowercase().as_str(), "0" | "false" | "no" | "off"),
        Err(_) => false,
    }
}

pub fn model_weights_cached(model: &str) -> bool {
    let home = match std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        Ok(v) => PathBuf::from(v),
        Err(_) => return false,
    };
    let snapshots = home
        .join(".cache")
        .join("huggingface")
        .join("hub")
        .join(format!("models--MuScriptor--muscriptor-{model}"))
        .join("snapshots");
    if !snapshots.is_dir() {
        return false;
    }
    let Ok(entries) = fs::read_dir(&snapshots) else {
        return false;
    };
    for entry in entries.flatten() {
        if entry.path().join("model.safetensors").is_file() {
            return true;
        }
    }
    false
}

pub fn probe_device() -> String {
    let output = Command::new(python_path())
        .args([
            "-c",
            "import torch; print('cuda' if torch.cuda.is_available() else 'cpu')",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let device = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if device.is_empty() {
                "cpu".into()
            } else {
                device
            }
        }
        _ => "cpu".into(),
    }
}

pub fn is_available(app: &AppHandle) -> bool {
    python_path().is_file() && resolve_script(app, "transcribe-muscriptor.py").is_file()
}

pub fn status(app: &AppHandle) -> serde_json::Value {
    let model = model_name();
    serde_json::json!({
        "available": is_available(app),
        "python": python_path().to_string_lossy(),
        "script": resolve_script(app, "transcribe-muscriptor.py").to_string_lossy(),
        "model": model,
        "fast": fast_mode(),
        "modelCached": model_weights_cached(&model),
        "device": if is_available(app) {
            serde_json::Value::String(probe_device())
        } else {
            serde_json::Value::Null
        },
    })
}

fn is_muscriptor_log_line(line: &str) -> bool {
    let line = line.trim();
    line.is_empty() || line.starts_with("[muscriptor]")
}

pub fn format_muscriptor_error(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "MuScriptor transcription failed.".into();
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
            return format_muscriptor_error(err);
        }
        if json.get("progress").is_some() {
            return "MuScriptor transcription failed.".into();
        }
    }

    let message: String = trimmed
        .lines()
        .filter(|line| {
            let line = line.trim();
            if is_muscriptor_log_line(line) {
                return false;
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                return json.get("progress").is_none();
            }
            true
        })
        .collect::<Vec<_>>()
        .join("\n");

    let lower = message.to_lowercase();
    if lower.contains("gated")
        || lower.contains("modeldownloaderror")
        || lower.contains("403")
        || (lower.contains("cannot download") && lower.contains("huggingface"))
    {
        return "MuScriptor model access required. Log in with hf auth login, then accept the license at https://huggingface.co/MuScriptor/muscriptor-large and retry.".into();
    }

    if message.is_empty() {
        "MuScriptor transcription failed.".into()
    } else {
        message
    }
}

fn parse_transcription_json(stdout: &str) -> Result<serde_json::Value, String> {
    let text = stdout.trim();
    if text.is_empty() {
        return Err("Empty MuScriptor output".into());
    }

    for line in text.lines().rev() {
        let line = line.trim();
        if !line.starts_with('{') || is_muscriptor_log_line(line) {
            continue;
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                return Err(format_muscriptor_error(err));
            }
            if json.get("engine").is_some()
                || json.get("voiceNotes").is_some()
                || json.get("instNotes").is_some()
            {
                return Ok(json);
            }
        }
    }

    if let Some(idx) = text.rfind("{\"engine\"") {
        return serde_json::from_str(&text[idx..])
            .map_err(|e| format!("Invalid transcription JSON: {e}"));
    }

    Err("No transcription JSON in MuScriptor output".into())
}

fn parse_script_failure(stdout: &str, stderr: &str) -> String {
    let stdout = stdout.trim();
    if !stdout.is_empty() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(stdout) {
            if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                return format_muscriptor_error(err);
            }
        }
    }
    format_muscriptor_error(if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    })
}

fn parse_result_line(line: &str) -> Result<Option<serde_json::Value>, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let json: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("Invalid MuScriptor JSON: {e}"))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(format_muscriptor_error(err));
    }
    if json.get("ready").is_some() || json.get("progress").is_some() {
        return Ok(None);
    }
    if json.get("engine").is_some()
        || json.get("voiceNotes").is_some()
        || json.get("instNotes").is_some()
    {
        return Ok(Some(json));
    }
    Ok(None)
}

fn clear_worker() {
    if let Ok(mut guard) = WORKER.lock() {
        if let Some(mut worker) = guard.take() {
            let _ = writeln!(worker.stdin, "{{\"cmd\":\"shutdown\"}}");
            let _ = worker.child.kill();
        }
    }
}

fn ensure_worker(app: &AppHandle) -> Result<(), String> {
    {
        let guard = WORKER.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }
    }

    let script = resolve_script(app, "transcribe-muscriptor.py");
    let model = model_name();
    let mut child = Command::new(python_path())
        .arg(&script)
        .arg("--worker")
        .arg("--model")
        .arg(&model)
        .args(if fast_mode() {
            vec!["--fast"]
        } else {
            vec!["--no-fast"]
        })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdin = child.stdin.take().ok_or("MuScriptor worker stdin unavailable")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("MuScriptor worker stdout unavailable")?;
    let mut reader = BufReader::new(stdout);

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3600);
    loop {
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            return Err("MuScriptor worker timed out while loading model".into());
        }
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| format!("MuScriptor worker read failed: {e}"))?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(Some(_)) = parse_result_line(&line) {
            return Err("Unexpected transcription payload before worker ready".into());
        }
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line.trim()) {
            if json.get("ready").and_then(|v| v.as_bool()) == Some(true) {
                let mut guard = WORKER.lock().map_err(|e| e.to_string())?;
                *guard = Some(Worker {
                    child,
                    stdin,
                    stdout: reader,
                });
                return Ok(());
            }
        }
    }
}

fn run_via_worker(in_path: &Path, target: &str) -> Result<serde_json::Value, String> {
    let mut guard = WORKER.lock().map_err(|e| e.to_string())?;
    let worker = guard
        .as_mut()
        .ok_or_else(|| "MuScriptor worker is not running".to_string())?;

    let payload = serde_json::json!({
        "audio": in_path.to_string_lossy(),
        "target": target,
        "fast": fast_mode(),
    });
    writeln!(worker.stdin, "{payload}")
        .map_err(|e| format!("MuScriptor worker write failed: {e}"))?;
    worker
        .stdin
        .flush()
        .map_err(|e| format!("MuScriptor worker flush failed: {e}"))?;

    loop {
        let mut line = String::new();
        let read = worker
            .stdout
            .read_line(&mut line)
            .map_err(|e| format!("MuScriptor worker read failed: {e}"))?;
        if read == 0 {
            clear_worker();
            return Err("MuScriptor worker exited unexpectedly".into());
        }
        if let Some(result) = parse_result_line(&line)? {
            return Ok(result);
        }
    }
}

fn run_one_shot(app: &AppHandle, in_path: &Path, target: &str) -> Result<serde_json::Value, String> {
    let script = resolve_script(app, "transcribe-muscriptor.py");
    let model = model_name();
    let mut cmd = Command::new(python_path());
    cmd.arg(script)
        .arg(in_path)
        .arg("--target")
        .arg(target)
        .arg("--model")
        .arg(&model);
    if fast_mode() {
        cmd.arg("--fast");
    } else {
        cmd.arg("--no-fast");
    }
    let output = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(parse_script_failure(&stdout, &stderr));
    }

    parse_transcription_json(&stdout)
}

pub fn run_transcription(
    app: &AppHandle,
    in_path: &Path,
    target: &str,
) -> Result<serde_json::Value, String> {
    let model = model_name();
    if model_weights_cached(&model) {
        if ensure_worker(app).is_ok() {
            match run_via_worker(in_path, target) {
                Ok(result) => return Ok(result),
                Err(err) => {
                    clear_worker();
                    eprintln!("[muscriptor] worker failed, using one-shot: {err}");
                }
            }
        }
    }
    run_one_shot(app, in_path, target)
}
