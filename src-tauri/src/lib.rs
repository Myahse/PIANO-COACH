use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const PYTHON_EXE: &str = r"C:\piano-coach-muscriptor\venv\Scripts\python.exe";

fn python_path() -> PathBuf {
    PathBuf::from(PYTHON_EXE)
}

fn muscriptor_script_path() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(|root| root.join("scripts").join("transcribe-muscriptor.py"))
        .unwrap_or_else(|| PathBuf::from("scripts/transcribe-muscriptor.py"))
}

fn separate_stems_script_path() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(|root| root.join("scripts").join("separate-stems.py"))
        .unwrap_or_else(|| PathBuf::from("scripts/separate-stems.py"))
}

fn muscriptor_model() -> String {
    std::env::var("PIANO_COACH_MUSCRIPTOR_MODEL").unwrap_or_else(|_| "large".into())
}

fn muscriptor_fast() -> bool {
    match std::env::var("PIANO_COACH_MUSCRIPTOR_FAST") {
        Ok(v) => !matches!(v.to_lowercase().as_str(), "0" | "false" | "no" | "off"),
        Err(_) => false,
    }
}

fn is_muscriptor_log_line(line: &str) -> bool {
    let line = line.trim();
    line.is_empty() || line.starts_with("[muscriptor]")
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
        return serde_json::from_str(&text[idx..]).map_err(|e| format!("Invalid transcription JSON: {e}"));
    }

    Err("No transcription JSON in MuScriptor output".into())
}

fn format_muscriptor_error(raw: &str) -> String {
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
        return "MuScriptor model access required. Log in with hf auth login, then accept the license at https://huggingface.co/MuScriptor/muscriptor-small and retry.".into();
    }

    if message.is_empty() {
        "MuScriptor transcription failed.".into()
    } else {
        message
    }
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
    format_muscriptor_error(if stderr.trim().is_empty() { stdout } else { stderr })
}

#[tauri::command]
fn muscriptor_available() -> bool {
    python_path().exists() && muscriptor_script_path().exists()
}

#[tauri::command]
fn demucs_available() -> bool {
    if !python_path().exists() || !separate_stems_script_path().exists() {
        return false;
    }
    Command::new(python_path())
        .args(["-c", "import demucs"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tauri::command]
fn separate_stems(audio: Vec<u8>, filename: String) -> Result<Vec<u8>, String> {
    if !demucs_available() {
        return Err("Demucs is not installed. pip install demucs in the MuScriptor Python environment.".into());
    }

    let tmp = std::env::temp_dir().join("piano-coach-stems");
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let safe_name = Path::new(&filename)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.mp3");
    let id = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let in_path = tmp.join(format!("in-{id}-{safe_name}"));
    fs::write(&in_path, &audio).map_err(|e| e.to_string())?;

    let output = Command::new(python_path())
        .arg(separate_stems_script_path())
        .arg(&in_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&in_path);
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }

    let json: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Invalid stem JSON: {e}"))?;
    if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
        return Err(err.into());
    }
    let inst_path = json
        .get("instruments")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Stem JSON missing instruments path".to_string())?;

    fs::read(inst_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn transcribe_muscriptor(audio: Vec<u8>, filename: String, target: String) -> Result<serde_json::Value, String> {
    if !muscriptor_available() {
        return Err("MuScriptor is not installed. Run scripts/setup-muscriptor.ps1".into());
    }

    let tmp = std::env::temp_dir().join("piano-coach-muscriptor");
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let safe_name = Path::new(&filename)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.mp3");
    let id = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let in_path = tmp.join(format!("in-{id}-{safe_name}"));

    fs::write(&in_path, &audio).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(python_path());
    cmd.arg(muscriptor_script_path())
        .arg(&in_path)
        .arg("--target")
        .arg(&target)
        .arg("--model")
        .arg(muscriptor_model());
    if muscriptor_fast() {
        cmd.arg("--fast");
    } else {
        cmd.arg("--no-fast");
    }
    let output = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&in_path);

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(parse_script_failure(&stdout, &stderr));
    }

    parse_transcription_json(&stdout)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            muscriptor_available,
            transcribe_muscriptor,
            demucs_available,
            separate_stems
        ])
        .run(tauri::generate_context!())
        .expect("error while running Piano Coach");
}
