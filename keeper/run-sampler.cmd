@echo off
REM Keeps the basis sampler running.
REM
REM It has now stopped three times, and each hole showed up later as a gap in the series.
REM The data is not reproducible after the fact, so an unattended restart is worth more
REM than a clean exit code. Any exit is treated as something to recover from.
REM
REM Two things the earlier version got wrong, both found in the 2026-09-22 stall:
REM
REM   timeout /nobreak needs a console. Started hidden, as it is meant to be, it fails
REM   instantly instead of waiting, so the first transient failure turned into a loop
REM   spinning at 40ms per cycle. ping against loopback waits whether or not anyone is
REM   attached. That stall ran for three hours and cost every sample in it.
REM
REM   npx resolves the binary on every single restart, which under that spin became
REM   hundreds of lookups a second and kept the failure alive on its own. tsx is already
REM   in node_modules, so call it directly and leave npx out of the restart path.
REM
REM Start hidden and detached:
REM   powershell -Command "Start-Process -FilePath keeper\run-sampler.cmd -WindowStyle Hidden"
cd /d "%~dp0.."

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo [%date% %time%] tsx missing, run npm install >> keeper\sampler.log
  exit /b 1
)

:loop
echo [%date% %time%] starting sampler >> keeper\sampler.log
node node_modules\tsx\dist\cli.mjs keeper\sample-basis.ts >> keeper\sampler.log 2>> keeper\sampler.err.log
echo [%date% %time%] sampler exited with %errorlevel%, restarting in 15s >> keeper\sampler.log
REM ping waits without a console; timeout does not.
ping -n 16 127.0.0.1 > nul
goto loop
