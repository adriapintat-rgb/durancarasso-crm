@echo off
REM ============================================================
REM  Durán Carasso — instalación completa en un solo paso.
REM  Doble clic. Crea la carpeta carrusel-factory al lado de este
REM  archivo, instala todo y genera el primer carrusel con IA.
REM ============================================================
setlocal
cd /d "%~dp0"

where git >nul 2>nul || (echo ERROR: falta Git. Instalalo desde https://git-scm.com/download/win & pause & exit /b 1)
where python >nul 2>nul || (echo ERROR: falta Python. Instalalo desde https://www.python.org/downloads/ marcando "Add to PATH" & pause & exit /b 1)

set DEST=%~dp0carrusel-factory

if not exist "%DEST%\scripts\generar.py" (
  echo [1/5] Descargando carrusel-factory...
  git clone https://github.com/david-ai-pro/carrusel-factory "%DEST%" || (echo ERROR al clonar. & pause & exit /b 1)
) else (
  echo [1/5] carrusel-factory ya esta descargado.
)

cd /d "%DEST%"

if not exist ".venv\Scripts\python.exe" (
  echo [2/5] Creando entorno Python...
  python -m venv .venv || (echo ERROR creando el entorno. & pause & exit /b 1)
)

echo [3/5] Instalando dependencias...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt || (echo ERROR instalando dependencias. & pause & exit /b 1)
.venv\Scripts\python.exe -m playwright install chromium || (echo ERROR instalando Chromium. & pause & exit /b 1)

echo [4/5] Aplicando el parche foto-real y la marca...
if exist "scripts\generar.py" copy /y "scripts\generar.py" "scripts\generar.py.bak" >nul
xcopy /e /i /y "%~dp0estilos\foto-real" "estilos\foto-real" >nul
copy /y "%~dp0scripts\generar.py" "scripts\generar.py" >nul
copy /y "%~dp0config.json" "config.json" >nul
copy /y "%~dp0trabajo\carrusel-foto-real.json" "trabajo\carrusel-foto-real.json" >nul
copy /y "%~dp0trabajo\carrusel-ia.json" "trabajo\carrusel-ia.json" >nul
if not exist "fotos" mkdir "fotos"

echo [5/5] Generando el primer carrusel (fondos IA gratis)...
copy /y "trabajo\carrusel-ia.json" "trabajo\carrusel.json" >nul
.venv\Scripts\python.exe scripts\generar.py

echo.
echo ============================================================
echo  LISTO. Tus slides estan en:
echo    %DEST%\output\
echo ============================================================
start "" "%DEST%\output"
pause
endlocal
