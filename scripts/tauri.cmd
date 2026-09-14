@echo off
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  call "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
)

if exist "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
  call "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo Rust cargo was not found. Close this terminal, open a new one, or install Rust from https://rustup.rs
  exit /b 1
)

npx --yes tauri %*
