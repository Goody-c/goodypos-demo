@echo off
setlocal
cd /d "%~dp0"

set "BUNDLED_NODE=%~dp0runtime\node.exe"
if exist "%BUNDLED_NODE%" (
  "%BUNDLED_NODE%" ".\scripts\start-goodypos.mjs" %*
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo GoodyPOS could not find its bundled runtime. Please re-extract the full release package and try again.
    pause
    exit /b 1
  )
  node ".\scripts\start-goodypos.mjs" %*
)

if errorlevel 1 (
  echo.
  echo GoodyPOS could not be started. Please check the message above and try again.
  pause
  exit /b 1
)

endlocal
exit /b 0
