@echo off
REM Copia el parche foto-real dentro de tu carpeta carrusel-factory.
REM Uso:  INSTALAR.bat C:\ruta\a\carrusel-factory
setlocal
if "%~1"=="" (
  echo Uso: INSTALAR.bat C:\ruta\a\carrusel-factory
  exit /b 1
)
set DEST=%~1
if not exist "%DEST%\scripts\generar.py" (
  echo ERROR: "%DEST%" no parece la carpeta carrusel-factory.
  exit /b 1
)
echo Copia de seguridad de generar.py...
copy /y "%DEST%\scripts\generar.py" "%DEST%\scripts\generar.py.bak" >nul
xcopy /e /i /y "%~dp0estilos\foto-real" "%DEST%\estilos\foto-real" >nul
copy /y "%~dp0scripts\generar.py" "%DEST%\scripts\generar.py" >nul
copy /y "%~dp0config.json" "%DEST%\config.json" >nul
if not exist "%DEST%\fotos" mkdir "%DEST%\fotos"
copy /y "%~dp0trabajo\carrusel-foto-real.json" "%DEST%\trabajo\carrusel-foto-real.json" >nul
copy /y "%~dp0trabajo\carrusel-ia.json" "%DEST%\trabajo\carrusel-ia.json" >nul
echo.
echo LISTO. Ahora:
echo   1) Mete tus fotos en %DEST%\fotos\
echo   2) copy trabajo\carrusel-foto-real.json trabajo\carrusel.json
echo   3) run.bat generar
endlocal
