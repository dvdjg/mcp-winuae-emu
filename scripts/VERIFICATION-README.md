# Scripts de Verificación WinUAE-DBG y MCP-WinUAE-Emu

Este directorio contiene scripts para verificar el correcto funcionamiento de:

1. **WinUAE-DBG**: Versión modificada de WinUAE con servidor GDB extendido
2. **MCP-WinUAE-Emu**: Herramientas MCP para control remoto del emulador

## Requisitos Previos

1. **WinUAE-DBG compilado** en `C:\Users\dvdjg\Documents\programa\AI\WinUAE-DBG\bin`
   - Ejecutable: `winuae-gdb.exe` o `winuae-gdb-x86.exe`

2. **Kickstart 1.3 ROM** en `C:\Amiga\KICK13.rom`

3. **Archivo de configuración** `C:\Amiga\A500-Dev.uae` con contenido:
   ```ini
   quickstart=a500,1
   chipmem_size=1
   kickstart_rom_file=C:\Amiga\KICK13.rom
   ```

4. **Juego ADF para pruebas** (default: `C:\Amiga\Turrican 3.adf`)

5. **Node.js** instalado (v18+)

## Scripts Disponibles

### verify-winuae-dbg.mjs

Verifica las funcionalidades del servidor GDB de WinUAE-DBG:

- Conexión GDB (puerto 2345)
- Lectura/escritura de registros CPU (D0-D7, A0-A7, SR, PC)
- Lectura/escritura de memoria (Chip RAM, Custom Registers)
- Breakpoints y Watchpoints
- Single-step y Continue/Pause
- Screenshots
- Desensamblado
- Simulación de input (teclado, joystick, ratón)
- Operaciones de disco (insert/eject en caliente)

**Uso:**
```bash
node scripts/verify-winuae-dbg.mjs
```

### verify-mcp-tools.mjs

Verifica todas las herramientas MCP disponibles:

| Tool | Descripción |
|------|-------------|
| `winuae_connect` | Conexión al servidor GDB |
| `winuae_status` | Estado de la conexión |
| `winuae_registers_get` | Lectura de registros |
| `winuae_registers_set` | Escritura de registros |
| `winuae_memory_read` | Lectura de memoria |
| `winuae_memory_write` | Escritura de memoria |
| `winuae_memory_dump` | Dump hex+ASCII |
| `winuae_custom_registers` | Registros custom chip |
| `winuae_breakpoint_set/clear` | Breakpoints |
| `winuae_watchpoint_set/clear` | Watchpoints |
| `winuae_step` | Single-step |
| `winuae_continue` | Reanudar ejecución |
| `winuae_pause` | Pausar ejecución |
| `winuae_screenshot` | Captura de pantalla |
| `winuae_disassemble_full` | Desensamblado m68k |
| `winuae_copper_disassemble` | Desensamblado Copper |
| `winuae_input_key` | Simulación teclado |
| `winuae_input_joy` | Simulación joystick |
| `winuae_input_mouse` | Simulación ratón |
| `winuae_insert_disk` | Insertar disco |
| `winuae_eject_disk` | Expulsar disco |

**Uso:**
```bash
node scripts/verify-mcp-tools.mjs
```

### run-verification.ps1 (PowerShell)

Script completo que ejecuta ambas verificaciones:

```powershell
# Ejecutar todas las verificaciones
.\scripts\run-verification.ps1

# Solo WinUAE-DBG
.\scripts\run-verification.ps1 -Mode winuae

# Solo MCP Tools
.\scripts\run-verification.ps1 -Mode mcp

# Con un juego diferente
.\scripts\run-verification.ps1 -GameAdf "C:\Amiga\Jim Power in Mutant Planet_Disk1.adf"
```

### run-verification.bat (CMD)

Versión batch para CMD:

```batch
REM Todas las verificaciones
scripts\run-verification.bat

REM Solo WinUAE-DBG
scripts\run-verification.bat winuae

REM Solo MCP Tools
scripts\run-verification.bat mcp
```

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `WINUAE_PATH` | `.../WinUAE-DBG/bin` | Directorio de WinUAE-DBG |
| `WINUAE_CONFIG` | `C:/Amiga/A500-Dev.uae` | Archivo de configuración |
| `WINUAE_GAME_ADF` | `C:/Amiga/Turrican 3.adf` | Juego para pruebas |
| `WINUAE_GDB_PORT` | `2345` | Puerto del servidor GDB |
| `WINUAE_OUTPUT_DIR` | `test-output/` | Directorio para evidencias |
| `WINUAE_GDB_INITIAL_DELAY_MS` | `8000` | Delay inicial para boot |

## Evidencias Generadas

Los scripts generan evidencias en `test-output/`:

| Archivo | Contenido |
|---------|-----------|
| `screenshot-01-initial.png` | Pantalla al iniciar |
| `screenshot-02-after-input.png` | Pantalla después de inputs |
| `screenshot-03-final.png` | Pantalla final |
| `custom-registers-dump.txt` | Dump hex de $DFF000 |
| `custom-registers.txt` | Registros decodificados |
| `disassembly.txt` | Desensamblado en PC actual |
| `copper-list.txt` | Copper list decodificada |
| `mcp-verification-report.md` | Reporte completo en Markdown |

## Interpretación de Resultados

### Códigos de salida
- `0`: Todas las pruebas pasaron
- `1`: Alguna prueba falló

### Colores en la salida
- 🟢 **PASS**: Prueba exitosa
- 🔴 **FAIL**: Prueba fallida
- 🟡 **SKIP**: Prueba omitida (condición no aplicable)

## Solución de Problemas

### "Connection refused" al conectar
- Verificar que no hay otro WinUAE corriendo
- Verificar que el puerto 2345 está libre: `netstat -an | findstr 2345`

### Pantalla negra en WinUAE
- Verificar que el Kickstart ROM es válido
- Verificar que el archivo ADF existe y es válido
- Aumentar `WINUAE_GDB_INITIAL_DELAY_MS` si el juego tarda en arrancar

### Timeout en comandos GDB
- Aumentar `WINUAE_GDB_MAX_ATTEMPTS` o `WINUAE_GDB_DELAY_MS`
- Verificar que WinUAE no está colgado

### Screenshots vacíos o corruptos
- Verificar que WinUAE tiene tiempo de renderizar (aumentar delays)
- Verificar que el directorio de salida es escribible

## Ejemplo de Salida Exitosa

```
═══════════════════════════════════════════════════════════════
       VERIFICACIÓN DE WinUAE-DBG - Extensiones GDB
═══════════════════════════════════════════════════════════════

[INFO] Iniciando WinUAE con Turrican 3.adf...
[INFO] Conectado. Esperando 10s para que arranque el juego...
[PASS] Conexión GDB - Puerto 2345
[PASS] Lectura de registros - PC=$FC0A24, SP(A7)=$7FFF0
[PASS] Lectura de memoria - $0000: 00000FF8...
[PASS] Lectura custom registers - VPOSR=$1200
[PASS] Escritura de memoria - Escrito $1000: DEADBEEF
[PASS] Escritura de registros - D0=$12345678 (restaurado)
...

═══════════════════════════════════════════════════════════════
                      RESUMEN DE RESULTADOS
═══════════════════════════════════════════════════════════════

PASADOS: 17
  ✓ Conexión GDB
  ✓ Lectura de registros
  ...

Total: 17/17 tests pasados (100%)

✓ Todos los tests pasaron correctamente
```
