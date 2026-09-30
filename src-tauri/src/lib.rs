mod muscriptor;

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::AppHandle;

#[tauri::command]
fn muscriptor_available(app: AppHandle) -> bool {
    muscriptor::is_available(&app)
}

#[tauri::command]
fn muscriptor_status(app: AppHandle) -> serde_json::Value {
    muscriptor::status(&app)
}

#[tauri::command]
fn demucs_available(app: AppHandle) -> bool {
    if !muscriptor::python_path().exists()
        || !muscriptor::resolve_script(&app, "separate-stems.py").exists()
    {
        return false;
    }
    Command::new(muscriptor::python_path())
        .args(["-c", "import demucs"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[derive(serde::Serialize)]
struct SeparateStemsResult {
    instruments: Vec<u8>,
    vocal: Vec<u8>,
}

#[tauri::command]
fn separate_stems(app: AppHandle, audio: Vec<u8>, filename: String) -> Result<SeparateStemsResult, String> {
    if !demucs_available(app.clone()) {
        return Err(
            "Demucs is not installed. pip install demucs in the MuScriptor Python environment."
                .into(),
        );
    }

    let tmp = std::env::temp_dir().join("piano-coach-stems");
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let id = temp_job_id();
    let in_path = muscriptor::temp_audio_path(&tmp, &id, &filename);
    write_temp_audio(&in_path, &audio)?;

    let output = Command::new(muscriptor::python_path())
        .arg(muscriptor::resolve_script(&app, "separate-stems.py"))
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
    let vocal_path = json
        .get("vocal")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Stem JSON missing vocal path".to_string())?;

    Ok(SeparateStemsResult {
        instruments: fs::read(inst_path).map_err(|e| e.to_string())?,
        vocal: fs::read(vocal_path).map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
fn transcribe_muscriptor(
    app: AppHandle,
    audio: Vec<u8>,
    filename: String,
    target: String,
) -> Result<serde_json::Value, String> {
    if !muscriptor::is_available(&app) {
        return Err("MuScriptor is not installed. Run scripts/setup-muscriptor.ps1".into());
    }

    let tmp = std::env::temp_dir().join("piano-coach-muscriptor");
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let id = temp_job_id();
    let in_path = muscriptor::temp_audio_path(&tmp, &id, &filename);

    write_temp_audio(&in_path, &audio)?;

    let result = muscriptor::run_transcription(&app, &in_path, &target);
    let _ = fs::remove_file(&in_path);
    result
}

fn temp_job_id() -> String {
    format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    )
}

fn write_temp_audio(path: &Path, audio: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, audio).map_err(|e| format!("Could not write temp audio ({}): {e}", path.display()))?;
    if !path.is_file() {
        return Err(format!("Temp audio missing after write: {}", path.display()));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            muscriptor_available,
            muscriptor_status,
            transcribe_muscriptor,
            demucs_available,
            separate_stems
        ])
        .run(tauri::generate_context!())
        .expect("error while running Piano Coach");
}
