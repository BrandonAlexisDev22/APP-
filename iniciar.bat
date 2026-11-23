@echo off
setlocal
title Firma masiva
cd /d "%~dp0"
set "PORT=8000"
set "URL=http://localhost:%PORT%"

echo === Firma masiva: preparando la aplicacion ===

rem --- Python 3.10+ ---
set "PY=python"
%PY% -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1 || (
    echo Instalando Python 3.12...
    winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
    set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)
"%PY%" -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1 || (
    echo [ERROR] No se encontro Python 3.10+. Instalalo desde https://www.python.org/downloads/ y vuelve a ejecutar.
    goto :fail
)

rem --- Node.js ---
where npm >nul 2>&1 || (
    echo Instalando Node.js LTS...
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where npm >nul 2>&1 || (
    echo [ERROR] No se encontro Node.js. Instalalo desde https://nodejs.org/ y vuelve a ejecutar.
    goto :fail
)

rem --- LibreOffice (opcional: diseno exacto de Word y archivos .doc) ---
if exist "%ProgramFiles%\LibreOffice\program\soffice.exe" set "SOFFICE=%ProgramFiles%\LibreOffice\program\soffice.exe"

rem --- Backend ---
if not exist "backend\.venv\Scripts\python.exe" (
    echo Creando entorno de Python...
    "%PY%" -m venv backend\.venv || goto :fail
)
echo Instalando dependencias del backend...
"backend\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r backend\requirements.txt || goto :fail

rem --- Frontend (mismo origen que el backend: sin VITE_API_URL) ---
set "VITE_API_URL="
pushd frontend
if not exist "node_modules" (
    echo Instalando dependencias del frontend...
    call npm ci || (popd & goto :fail)
)
echo Compilando el frontend...
call npm run build || (popd & goto :fail)
popd

rem --- Abrir el navegador cuando el servidor responda ---
start "" /b cmd /c "for /l %%i in (1,1,60) do (curl -s -o nul %URL%/docs && (start %URL% & exit) & ping -n 2 127.0.0.1 >nul)"

echo.
echo === Aplicacion en %URL%  (cierra esta ventana para detenerla) ===
cd backend
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port %PORT%
goto :eof

:fail
echo.
echo No se pudo iniciar la aplicacion. Revisa los mensajes de arriba.
pause
exit /b 1
