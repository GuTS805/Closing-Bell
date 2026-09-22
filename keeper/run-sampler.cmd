@echo off
REM Keeps the basis sampler running.
REM
REM It has now stopped twice without writing anything to stderr - killed rather than
REM crashed - and each time the hole showed up later as a gap in the series. The data is
REM not reproducible after the fact, so an unattended restart is worth more than a clean
REM exit code. Any exit is treated as something to recover from, not a reason to stop.
REM
REM Start hidden and detached:
REM   powershell -Command "Start-Process -FilePath keeper\run-sampler.cmd -WindowStyle Hidden"
cd /d "%~dp0.."
:loop
echo [%date% %time%] starting sampler >> keeper\sampler.log
call npx tsx keeper/sample-basis.ts >> keeper\sampler.log 2>> keeper\sampler.err.log
echo [%date% %time%] sampler exited, restarting in 15s >> keeper\sampler.log
timeout /t 15 /nobreak > nul
goto loop
