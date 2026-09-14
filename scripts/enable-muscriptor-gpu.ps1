# Reinstall PyTorch with CUDA 12.8 for RTX 50-series (Blackwell) GPUs.
$Venv = "C:\piano-coach-muscriptor\venv"
$Python = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Python)) {
  Write-Error "MuScriptor venv not found. Run scripts/setup-muscriptor.ps1 first."
  exit 1
}

Write-Host "Replacing CPU PyTorch with CUDA 12.8 build..."
& $Python -m pip uninstall -y torch torchvision torchaudio
& $Python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "GPU check:"
& $Python -c @"
import torch
print('torch', torch.__version__)
print('cuda', torch.cuda.is_available())
if torch.cuda.is_available():
    x = torch.rand(2, device='cuda')
    print('gpu', torch.cuda.get_device_name(0))
    print('ok', 'GPU tensor test passed')
else:
    print('gpu', 'not detected')
"@
