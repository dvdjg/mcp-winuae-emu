@echo off
REM test-debug-calculator.bat - Inicia WinUAE con la calculadora para depuración
REM Ejecuta esto y luego F5 en Cursor para depurar

set WINUAE_PATH=C:\Users\dvdjg\Documents\programa\AI\WinUAE-DBG\bin\winuae-gdb.exe
set CONFIG_PATH=C:\Users\dvdjg\Documents\programa\AI\Cursor-Amiga-C\.vscode\mcp-amiga-debug.uae

echo ========================================
echo   Prueba de Depuracion Amiga
echo ========================================
echo.
echo Comprobando archivos...

if not exist "%WINUAE_PATH%" (
    echo ERROR: No se encuentra WinUAE en:
    echo   %WINUAE_PATH%
    exit /b 1
)

if not exist "%CONFIG_PATH%" (
    echo ERROR: No se encuentra la configuracion en:
    echo   %CONFIG_PATH%
    exit /b 1
)

echo WinUAE: %WINUAE_PATH%
echo Config: %CONFIG_PATH%
echo.
echo Iniciando WinUAE con configuracion de depuracion...
echo - Config: mcp-amiga-debug.uae
echo - Puerto GDB: 2345
echo.

"%WINUAE_PATH%" -f "%CONFIG_PATH%"

echo.
echo WinUAE finalizado.
