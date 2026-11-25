@echo off
setlocal
if exist "%~dp0offline.html" (
  start "" "%~dp0offline.html"
  exit /b
)
set "APP=%~dp0serve.py"
set "BUNDLED=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "PYTHON_EXE="
set "PYTHON_FLAG="
if exist "%BUNDLED%" set "PYTHON_EXE=%BUNDLED%"
if defined PYTHON_EXE goto run
where py >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=py"
  set "PYTHON_FLAG=-3"
  goto run
)
where python >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=python"
  goto run
)
echo Python 3 is required to start the local app.
pause
exit /b 1
:run
echo Open http://127.0.0.1:8765/ in your browser. Keep this window open.
"%PYTHON_EXE%" %PYTHON_FLAG% "%APP%"
if errorlevel 1 pause
