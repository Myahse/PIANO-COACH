# One-time setup: MuScriptor transcription (https://github.com/muscriptor/muscriptor)
$Root = "C:\piano-coach-muscriptor"
$Venv = Join-Path $Root "venv"
$ProjectRoot = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path $Root)) { New-Item -ItemType Directory -Path $Root | Out-Null }

$Python = "$env:LOCALAPPDATA\Microsoft\WindowsApps\python3.12.exe"
if (-not (Test-Path $Python)) {
  $Python = "$env:LOCALAPPDATA\Microsoft\WindowsApps\python3.13.exe"
}
if (-not (Test-Path $Python)) {
  Write-Error "Python 3.12+ not found. Install from python.org (MuScriptor works best on 3.10-3.12)."
  exit 1
}

if (-not (Test-Path "$Venv\Scripts\pip.exe")) {
  Write-Host "Creating virtual environment at $Venv ..."
  & $Python -m venv $Venv
}

Write-Host "Installing MuScriptor..."
& "$Venv\Scripts\python.exe" -m pip install muscriptor mido
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Installing PyTorch with CUDA 12.8 (required for RTX 50-series / Blackwell GPUs)..."
& "$Venv\Scripts\python.exe" -m pip uninstall -y torch torchvision torchaudio 2>$null
& "$Venv\Scripts\python.exe" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Checking GPU..."
& "$Venv\Scripts\python.exe" -c @"
import torch
print('torch', torch.__version__)
print('cuda', torch.cuda.is_available())
if torch.cuda.is_available():
    print('gpu', torch.cuda.get_device_name(0))
else:
    print('gpu', 'not detected — transcription will use CPU (much slower)')
"@

Write-Host ""
Write-Host "MuScriptor is ready for Piano Coach."
Write-Host "Before first transcription:"
Write-Host "  1. Accept licenses: https://huggingface.co/MuScriptor/muscriptor-large (and small/medium if needed)"
Write-Host "  2. Log in:  $Venv\Scripts\hf.exe auth login"
Write-Host "     (or set HF_TOKEN in your environment)"
Write-Host ""
Write-Host "Default model: large (best quality, ~5.5 GB download). Override with PIANO_COACH_MUSCRIPTOR_MODEL=medium or small."
Write-Host "Before first import, download the model once:"
Write-Host "  powershell -ExecutionPolicy Bypass -File $ProjectRoot\scripts\download-muscriptor-model.ps1"
Write-Host "Quality mode is default (sequential chunks, prelude forcing). Faster but less accurate: PIANO_COACH_MUSCRIPTOR_FAST=1."
Write-Host "Even higher quality (slower): PIANO_COACH_MUSCRIPTOR_BEAM=2  (or 3 for long songs)"
Write-Host "For piano-only songs, choose Transcribe: Piano only before import."
