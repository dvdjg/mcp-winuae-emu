# Reporte de Verificación MCP-WinUAE-Emu

**Fecha:** 2026-02-21T01:24:33.612Z

**Configuración:**
- WinUAE Path: `C:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin`
- Config File: `C:/Amiga/A500-Dev.uae`
- Juego: `C:/Amiga/Turrican 3.adf`

## Resumen

| Resultado | Cantidad |
|-----------|----------|
| Pasados   | 26 |
| Fallidos  | 3 |
| Omitidos  | 0 |

## Tests Pasados

- **winuae_connect**: Conectado al puerto 2345
- **winuae_status**: Connected and healthy
- **winuae_screenshot**: screenshot-01-initial.png (20499 bytes)
- **winuae_registers_get**: PC=$500F4, A7=$C01466, SR=$1
- **winuae_registers_set**: D0 escrito y restaurado
- **winuae_memory_read**: $0100: 00000000000000000000000000000000...
- **winuae_memory_write**: $2000: CAFEBABE
- **winuae_memory_dump**: Dumped 256 bytes to custom-registers-dump.txt
- **winuae_breakpoint_set**: $FC00A0
- **winuae_breakpoint_clear**: $FC00A0
- **winuae_watchpoint_set**: $1000, len=4, type=write
- **winuae_watchpoint_clear**: $1000
- **winuae_continue**: Ejecución reanudada
- **winuae_pause**: Stop reply: S05
- **winuae_disassemble_full**: 000500fa : 66f8                 BNE.B #$f8
- **winuae_copper_disassemble**: COP1LC=$50532
- **winuae_continue**: Ejecución reanudada
- **winuae_input_key**: Space (0x40)
- **winuae_input_joy**: Port 0: Up + Fire
- **winuae_input_mouse**: Move + Left click
- **winuae_pause**: Stop reply: S05
- **winuae_screenshot**: screenshot-02-after-input.png (19018 bytes)
- **winuae_eject_disk**: DF0:
- **winuae_continue**: Ejecución reanudada
- **winuae_pause**: Stop reply: S05
- **winuae_screenshot**: screenshot-03-final.png (19399 bytes)

## Tests Fallidos

- **winuae_custom_registers**: Memory read error at $dff000: E01
- **winuae_step**: GDB command timeout: vCont;s
- **winuae_insert_disk**: Monitor command failed: E01

## Evidencias Generadas

- **Screenshot: screenshot-01-initial.png**: `screenshot-01-initial.png`
- **Custom registers dump ($DFF000)**: `custom-registers-dump.txt`
- **Disassembly at PC**: `disassembly.txt`
- **Copper list disassembly**: `copper-list.txt`
- **Screenshot: screenshot-02-after-input.png**: `screenshot-02-after-input.png`
- **Screenshot: screenshot-03-final.png**: `screenshot-03-final.png`

---
*Generado por verify-mcp-tools.mjs*
