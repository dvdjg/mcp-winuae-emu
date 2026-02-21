# Reporte de Verificación MCP-WinUAE-Emu

**Fecha:** 2026-02-21T01:10:10.486Z

**Configuración:**
- WinUAE Path: `C:/Users/dvdjg/Documents/programa/AI/WinUAE-DBG/bin`
- Config File: `C:/Amiga/A500-Dev.uae`
- Juego: `C:/Amiga/Turrican 3.adf`

## Resumen

| Resultado | Cantidad |
|-----------|----------|
| Pasados   | 25 |
| Fallidos  | 4 |
| Omitidos  | 0 |

## Tests Pasados

- **winuae_connect**: Conectado al puerto 2345
- **winuae_status**: Connected and healthy
- **winuae_screenshot**: screenshot-01-initial.png (19399 bytes)
- **winuae_registers_get**: PC=$500FA, A7=$C01466, SR=$9
- **winuae_memory_read**: $0100: 00000000000000000000000000000000...
- **winuae_memory_dump**: Dumped 256 bytes to custom-registers-dump.txt
- **winuae_breakpoint_set**: $FC00A0
- **winuae_breakpoint_clear**: $FC00A0
- **winuae_watchpoint_set**: $1000, len=4, type=write
- **winuae_watchpoint_clear**: $1000
- **winuae_step**: PC: $500fa → $fc0718
- **winuae_continue**: Ejecución reanudada
- **winuae_pause**: Stop reply: S05
- **winuae_disassemble_full**: 00fc0f90 : 4e72 2000            STOP.L #$2000
- **winuae_copper_disassemble**: COP1LC=$420
- **winuae_continue**: Ejecución reanudada
- **winuae_input_key**: Space (0x40)
- **winuae_input_joy**: Port 0: Up + Fire
- **winuae_input_mouse**: Move + Left click
- **winuae_pause**: Stop reply: S05
- **winuae_screenshot**: screenshot-02-after-input.png (29308 bytes)
- **winuae_eject_disk**: DF0:
- **winuae_continue**: Ejecución reanudada
- **winuae_pause**: Stop reply: S05
- **winuae_screenshot**: screenshot-03-final.png (15586 bytes)

## Tests Fallidos

- **winuae_registers_set**: Register write failed for reg 0: 
- **winuae_memory_write**: Memory write error at $2000: 
- **winuae_custom_registers**: Memory read error at $dff000: E01
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
