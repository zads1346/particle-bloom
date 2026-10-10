@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  node server.mjs
  goto end
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; assert sys.version_info.major == 3" >nul 2>nul
  if not errorlevel 1 (
    py -3 serve.py
    goto end
  )
)
where python3 >nul 2>nul
if not errorlevel 1 (
  python3 serve.py
  goto end
)
where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys; assert sys.version_info.major == 3" >nul 2>nul
  if not errorlevel 1 (
    python serve.py
    goto end
  )
)
echo No usable Node.js or Python 3 was found.
echo Please see QUICKSTART-ZH.md. This launcher does not install anything.
echo Node.js: https://nodejs.org/   Python: https://www.python.org/
:end
echo.
pause
