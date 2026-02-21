@echo off
REM Script de verificación completa de WinUAE-DBG y MCP-WinUAE-Emu
REM Ejecuta ambos scripts de verificación y genera un reporte completo.
REM
REM Uso: run-verification.bat [winuae|mcp|all]
REM   winuae - Solo verifica WinUAE-DBG (servidor GDB)
REM   mcp    - Solo verifica herramientas MCP
REM   all    - Verifica ambos (default)

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..
set OUTPUT_DIR=%PROJECT_DIR%\test-output

REM Configuración (modificar según tu instalación)
set WINUAE_PATH=C:\Users\dvdjg\Documents\programa\AI\WinUAE-DBG\bin
set WINUAE_CONFIG=C:\Amiga\A500-Dev.uae
set WINUAE_GAME_ADF=C:\Amiga\Turrican 3.adf
set WINUAE_GDB_PORT=2345
set WINUAE_GDB_INITIAL_DELAY_MS=8000

REM Colores
set "GREEN=[32m"
set "RED=[31m"
set "YELLOW=[33m"
set "CYAN=[36m"
set "RESET=[0m"

echo.
echo %CYAN%===============================================================%RESET%
echo %CYAN%       VERIFICACION DE WinUAE-DBG y MCP-WinUAE-Emu            %RESET%
echo %CYAN%===============================================================%RESET%
echo.

REM Verificar argumento
set MODE=%1
if "%MODE%"=="" set MODE=all

REM Crear directorio de salida
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

REM Verificar que los archivos necesarios existen
echo %CYAN%[INFO]%RESET% Verificando archivos necesarios...

if not exist "%WINUAE_PATH%\winuae-gdb.exe" (
    if not exist "%WINUAE_PATH%\winuae-gdb-x86.exe" (
        echo %RED%[ERROR]%RESET% No se encuentra WinUAE-DBG en: %WINUAE_PATH%
        exit /b 1
    )
)
echo   - WinUAE-DBG: OK

if not exist "%WINUAE_CONFIG%" (
    echo %RED%[ERROR]%RESET% No se encuentra config: %WINUAE_CONFIG%
    exit /b 1
)
echo   - Config: OK

if not exist "%WINUAE_GAME_ADF%" (
    echo %RED%[ERROR]%RESET% No se encuentra juego: %WINUAE_GAME_ADF%
    exit /b 1
)
echo   - Game ADF: OK

if not exist "%PROJECT_DIR%\dist\winuae-connection.js" (
    echo %YELLOW%[WARN]%RESET% Proyecto no compilado. Compilando...
    cd /d "%PROJECT_DIR%"
    call npm run build
    if errorlevel 1 (
        echo %RED%[ERROR]%RESET% Fallo al compilar el proyecto
        exit /b 1
    )
)
echo   - MCP compilado: OK
echo.

REM Ejecutar verificaciones
set WINUAE_RESULT=0
set MCP_RESULT=0

if "%MODE%"=="winuae" goto :run_winuae
if "%MODE%"=="mcp" goto :run_mcp
if "%MODE%"=="all" goto :run_all

echo %RED%[ERROR]%RESET% Modo desconocido: %MODE%
echo Uso: run-verification.bat [winuae^|mcp^|all]
exit /b 1

:run_all
:run_winuae
echo %CYAN%===============================================================%RESET%
echo %CYAN%  Fase 1: Verificacion de WinUAE-DBG                           %RESET%
echo %CYAN%===============================================================%RESET%
echo.

cd /d "%PROJECT_DIR%"
node scripts/verify-winuae-dbg.mjs
set WINUAE_RESULT=%errorlevel%

if "%MODE%"=="winuae" goto :summary

echo.
echo %YELLOW%[INFO]%RESET% Esperando 5 segundos antes de la siguiente fase...
timeout /t 5 /nobreak >nul
echo.

:run_mcp
echo %CYAN%===============================================================%RESET%
echo %CYAN%  Fase 2: Verificacion de MCP Tools                            %RESET%
echo %CYAN%===============================================================%RESET%
echo.

cd /d "%PROJECT_DIR%"
node scripts/verify-mcp-tools.mjs
set MCP_RESULT=%errorlevel%

:summary
echo.
echo %CYAN%===============================================================%RESET%
echo %CYAN%                    RESUMEN FINAL                              %RESET%
echo %CYAN%===============================================================%RESET%
echo.

if "%MODE%"=="winuae" (
    if %WINUAE_RESULT%==0 (
        echo %GREEN%[OK]%RESET% WinUAE-DBG: TODAS LAS PRUEBAS PASARON
    ) else (
        echo %RED%[FAIL]%RESET% WinUAE-DBG: ALGUNAS PRUEBAS FALLARON
    )
) else if "%MODE%"=="mcp" (
    if %MCP_RESULT%==0 (
        echo %GREEN%[OK]%RESET% MCP Tools: TODAS LAS PRUEBAS PASARON
    ) else (
        echo %RED%[FAIL]%RESET% MCP Tools: ALGUNAS PRUEBAS FALLARON
    )
) else (
    if %WINUAE_RESULT%==0 (
        echo %GREEN%[OK]%RESET% WinUAE-DBG: TODAS LAS PRUEBAS PASARON
    ) else (
        echo %RED%[FAIL]%RESET% WinUAE-DBG: ALGUNAS PRUEBAS FALLARON
    )
    if %MCP_RESULT%==0 (
        echo %GREEN%[OK]%RESET% MCP Tools: TODAS LAS PRUEBAS PASARON
    ) else (
        echo %RED%[FAIL]%RESET% MCP Tools: ALGUNAS PRUEBAS FALLARON
    )
)

echo.
echo %CYAN%Evidencias guardadas en:%RESET% %OUTPUT_DIR%
echo.

REM Listar archivos de evidencia
if exist "%OUTPUT_DIR%" (
    echo Archivos generados:
    dir /b "%OUTPUT_DIR%"
)

echo.
set /a TOTAL_RESULT=%WINUAE_RESULT%+%MCP_RESULT%
if %TOTAL_RESULT%==0 (
    echo %GREEN%=========================================%RESET%
    echo %GREEN% VERIFICACION COMPLETA EXITOSA          %RESET%
    echo %GREEN%=========================================%RESET%
) else (
    echo %RED%=========================================%RESET%
    echo %RED% ALGUNAS VERIFICACIONES FALLARON        %RESET%
    echo %RED%=========================================%RESET%
)

exit /b %TOTAL_RESULT%
