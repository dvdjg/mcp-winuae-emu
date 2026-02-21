<#
.SYNOPSIS
    Script de verificación completa de WinUAE-DBG y MCP-WinUAE-Emu

.DESCRIPTION
    Ejecuta pruebas automatizadas para verificar:
    1. WinUAE-DBG: Servidor GDB extendido (breakpoints, memoria, registros, etc.)
    2. MCP-WinUAE-Emu: Herramientas MCP para control remoto del emulador
    
    Genera evidencias (screenshots, dumps, logs) en el directorio test-output/

.PARAMETER Mode
    Modo de ejecución:
    - winuae: Solo verifica WinUAE-DBG
    - mcp: Solo verifica herramientas MCP
    - all: Verifica ambos (default)

.PARAMETER GameAdf
    Ruta al archivo ADF del juego para pruebas (default: Turrican 3)

.EXAMPLE
    .\run-verification.ps1
    Ejecuta todas las verificaciones

.EXAMPLE
    .\run-verification.ps1 -Mode mcp
    Solo verifica las herramientas MCP

.EXAMPLE
    .\run-verification.ps1 -GameAdf "C:\Amiga\Jim Power in Mutant Planet_Disk1.adf"
    Usa un juego diferente para las pruebas
#>

param(
    [ValidateSet('winuae', 'mcp', 'all')]
    [string]$Mode = 'all',
    
    [string]$GameAdf = 'C:\Amiga\Turrican 3.adf',
    
    [string]$WinUAEPath = 'C:\Users\dvdjg\Documents\programa\AI\WinUAE-DBG\bin',
    
    [string]$ConfigFile = 'C:\Amiga\A500-Dev.uae'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$OutputDir = Join-Path $ProjectDir 'test-output'

# Configuración de entorno
$env:WINUAE_PATH = $WinUAEPath
$env:WINUAE_CONFIG = $ConfigFile
$env:WINUAE_GAME_ADF = $GameAdf
$env:WINUAE_OUTPUT_DIR = $OutputDir
$env:WINUAE_GDB_PORT = '2345'
$env:WINUAE_GDB_INITIAL_DELAY_MS = '8000'

# Colores
function Write-Header($text) {
    Write-Host ""
    Write-Host "═" * 65 -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "═" * 65 -ForegroundColor Cyan
    Write-Host ""
}

function Write-Info($text) {
    Write-Host "[INFO] " -ForegroundColor Cyan -NoNewline
    Write-Host $text
}

function Write-Success($text) {
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $text
}

function Write-Failure($text) {
    Write-Host "[FAIL] " -ForegroundColor Red -NoNewline
    Write-Host $text
}

function Write-Warning($text) {
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $text
}

# Banner
Write-Header "VERIFICACION DE WinUAE-DBG y MCP-WinUAE-Emu"

# Verificar archivos necesarios
Write-Info "Verificando archivos necesarios..."

$winuaeExe = Join-Path $WinUAEPath 'winuae-gdb.exe'
$winuaeExeAlt = Join-Path $WinUAEPath 'winuae-gdb-x86.exe'

if (-not (Test-Path $winuaeExe) -and -not (Test-Path $winuaeExeAlt)) {
    Write-Failure "No se encuentra WinUAE-DBG en: $WinUAEPath"
    exit 1
}
Write-Host "  - WinUAE-DBG: " -NoNewline
Write-Host "OK" -ForegroundColor Green

if (-not (Test-Path $ConfigFile)) {
    Write-Failure "No se encuentra config: $ConfigFile"
    exit 1
}
Write-Host "  - Config: " -NoNewline
Write-Host "OK" -ForegroundColor Green

if (-not (Test-Path $GameAdf)) {
    Write-Failure "No se encuentra juego: $GameAdf"
    exit 1
}
Write-Host "  - Game ADF: " -NoNewline
Write-Host "OK" -ForegroundColor Green

$distFile = Join-Path $ProjectDir 'dist\winuae-connection.js'
if (-not (Test-Path $distFile)) {
    Write-Warning "Proyecto no compilado. Compilando..."
    Push-Location $ProjectDir
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Failure "Fallo al compilar el proyecto"
        Pop-Location
        exit 1
    }
    Pop-Location
}
Write-Host "  - MCP compilado: " -NoNewline
Write-Host "OK" -ForegroundColor Green

# Crear directorio de salida
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

Write-Host ""
Write-Info "Configuración:"
Write-Host "  WinUAE Path: $WinUAEPath"
Write-Host "  Config:      $ConfigFile"
Write-Host "  Game:        $(Split-Path -Leaf $GameAdf)"
Write-Host "  Output:      $OutputDir"
Write-Host ""

# Variables de resultado
$winuaeResult = 0
$mcpResult = 0
$startTime = Get-Date

# Función para ejecutar verificación
function Run-Verification {
    param([string]$Script, [string]$Name)
    
    Write-Header $Name
    
    Push-Location $ProjectDir
    try {
        node $Script
        return $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}

# Ejecutar verificaciones según el modo
switch ($Mode) {
    'winuae' {
        $winuaeResult = Run-Verification 'scripts/verify-winuae-dbg.mjs' 'Verificación de WinUAE-DBG'
    }
    'mcp' {
        $mcpResult = Run-Verification 'scripts/verify-mcp-tools.mjs' 'Verificación de MCP Tools'
    }
    'all' {
        $winuaeResult = Run-Verification 'scripts/verify-winuae-dbg.mjs' 'Fase 1: Verificación de WinUAE-DBG'
        
        Write-Info "Esperando 5 segundos antes de la siguiente fase..."
        Start-Sleep -Seconds 5
        
        $mcpResult = Run-Verification 'scripts/verify-mcp-tools.mjs' 'Fase 2: Verificación de MCP Tools'
    }
}

$endTime = Get-Date
$duration = $endTime - $startTime

# Resumen
Write-Header "RESUMEN FINAL"

if ($Mode -eq 'winuae' -or $Mode -eq 'all') {
    if ($winuaeResult -eq 0) {
        Write-Success "WinUAE-DBG: TODAS LAS PRUEBAS PASARON"
    } else {
        Write-Failure "WinUAE-DBG: ALGUNAS PRUEBAS FALLARON"
    }
}

if ($Mode -eq 'mcp' -or $Mode -eq 'all') {
    if ($mcpResult -eq 0) {
        Write-Success "MCP Tools: TODAS LAS PRUEBAS PASARON"
    } else {
        Write-Failure "MCP Tools: ALGUNAS PRUEBAS FALLARON"
    }
}

Write-Host ""
Write-Info "Duración total: $($duration.ToString('mm\:ss'))"
Write-Info "Evidencias guardadas en: $OutputDir"
Write-Host ""

# Listar archivos generados
if (Test-Path $OutputDir) {
    Write-Host "Archivos generados:" -ForegroundColor Cyan
    Get-ChildItem $OutputDir | ForEach-Object {
        $size = if ($_.Length -gt 1024) { "$([math]::Round($_.Length / 1024, 1)) KB" } else { "$($_.Length) bytes" }
        Write-Host "  - $($_.Name) ($size)"
    }
}

Write-Host ""
$totalResult = $winuaeResult + $mcpResult
if ($totalResult -eq 0) {
    Write-Host "═" * 45 -ForegroundColor Green
    Write-Host " VERIFICACION COMPLETA EXITOSA" -ForegroundColor Green
    Write-Host "═" * 45 -ForegroundColor Green
} else {
    Write-Host "═" * 45 -ForegroundColor Red
    Write-Host " ALGUNAS VERIFICACIONES FALLARON" -ForegroundColor Red
    Write-Host "═" * 45 -ForegroundColor Red
}

exit $totalResult
