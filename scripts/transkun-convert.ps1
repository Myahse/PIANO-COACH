
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$AudioPath,
  [string]$OutPath = "",
  [string]$Device = "cpu"
)

$Transkun = "C:\piano-coach-transkun\venv\Scripts\transkun.exe"
if (-not (Test-Path $Transkun)) {
  Write-Error "Transkun not installed. Run: .\scripts\setup-python-transkun.ps1"
  exit 1
}
if (-not (Test-Path $AudioPath)) {
  Write-Error "File not found: $AudioPath"
  exit 1
}

if ($OutPath -eq "") {
  $OutPath = [System.IO.Path]::ChangeExtension($AudioPath, ".mid")
}

Write-Host "Transkun V2 (Python) converting..."
Write-Host "  Input:  $AudioPath"
Write-Host "  Output: $OutPath"
Write-Host "(This may take a few minutes on CPU.)"

& $Transkun $AudioPath $OutPath --device $Device
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done. Import into Piano Coach Library:"
Write-Host "  $OutPath"
