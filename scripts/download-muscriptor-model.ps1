# One-time download of MuScriptor model weights (~5.5 GB for large).
# Run this BEFORE importing songs so transcription doesn't sit on "loading model" for 30+ min.
param(
  [ValidateSet("small", "medium", "large")]
  [string]$Model = "large"
)

$Python = "C:\piano-coach-muscriptor\venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
  Write-Error "MuScriptor venv not found. Run scripts/setup-muscriptor.ps1 first."
  exit 1
}

Write-Host "Checking HuggingFace login..."
& "$Python" -m huggingface_hub.cli.hf auth whoami 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Log in first:  $Python -m huggingface_hub.cli.hf auth login"
  Write-Host "Accept license: https://huggingface.co/MuScriptor/muscriptor-$Model"
  exit 1
}

# Concurrent imports spawn multiple downloaders and stall forever — clean up first.
$blobs = Join-Path $env:USERPROFILE ".cache\huggingface\hub\models--MuScriptor--muscriptor-$Model\blobs"
$locks = Join-Path $env:USERPROFILE ".cache\huggingface\hub\.locks\models--MuScriptor--muscriptor-$Model"
if (Test-Path $locks) { Remove-Item $locks -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $blobs) {
  $inc = Get-ChildItem $blobs -Filter "*.incomplete" -ErrorAction SilentlyContinue
  if ($inc.Count -gt 1) {
    $keep = $inc | Sort-Object Length -Descending | Select-Object -First 1
    $inc | Where-Object { $_.FullName -ne $keep.FullName } | Remove-Item -Force
    Write-Host "Removed stale partial downloads; kept $([math]::Round($keep.Length / 1GB, 2)) GB partial file."
  }
}

Write-Host ""
Write-Host "Downloading muscriptor-$Model (first time only; large is ~5.5 GB)..."
Write-Host "Keep this window open until it finishes. Do not import songs while this runs."
Write-Host ""

& $Python -c @"
import time
from huggingface_hub import hf_hub_download, get_hf_file_metadata, hf_hub_url

repo = 'MuScriptor/muscriptor-$Model'
filename = 'model.safetensors'
meta = get_hf_file_metadata(hf_hub_url(repo, filename))
total = meta.size or 0
print(f'Expected size: {total / 1e9:.2f} GB', flush=True)

import threading
done = threading.Event()
err = []

def run():
    try:
        hf_hub_download(repo_id=repo, filename=filename)
    except Exception as e:
        err.append(e)
    finally:
        done.set()

threading.Thread(target=run, daemon=True).start()
t0 = time.time()
while not done.wait(3):
    elapsed = int(time.time() - t0)
    mins, secs = divmod(elapsed, 60)
    # Poll incomplete blob size
    from pathlib import Path
    blobs = Path.home() / '.cache' / 'huggingface' / 'hub' / f'models--MuScriptor--muscriptor-$Model' / 'blobs'
    got = 0
    if blobs.exists():
        for p in blobs.glob('*.incomplete'):
            got = max(got, p.stat().st_size)
        for p in blobs.iterdir():
            if p.is_file() and not p.name.endswith('.incomplete'):
                got = max(got, p.stat().st_size)
    if total > 0 and got > 0:
        pct = min(99, int(100 * got / total))
        print(f'  {pct}% ({got / 1e9:.2f} / {total / 1e9:.2f} GB) · {mins}m {secs}s', flush=True)
    else:
        print(f'  starting… · {mins}m {secs}s', flush=True)

if err:
    raise err[0]
path = hf_hub_download(repo_id=repo, filename=filename, local_files_only=True)
print(f'Done: {path}', flush=True)
"@

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "Model ready. Restart npm run dev and import your song."
