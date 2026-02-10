# mcp-winuae-emu

An [MCP](https://modelcontextprotocol.io/) server that provides Amiga 68k debugging tools through the WinUAE emulator. It connects to a [custom WinUAE fork](https://github.com/axewater/WinUAE/tree/gdb-write-commands) via GDB Remote Serial Protocol (RSP), giving AI assistants direct read-write access to the emulated Amiga hardware.

## What it does

This server lets an AI assistant (Claude, etc.) launch WinUAE, connect to its GDB server, and then read/write memory, read/write registers, set breakpoints, single-step through code, disassemble Copper lists, and more -- all through MCP tool calls.

## Quick Start

### 1. Download the pre-built WinUAE binary

Download `winuae-gdb.exe` from the [WinUAE fork releases](https://github.com/axewater/WinUAE/releases) and place it in a directory (e.g., `C:\apps\winuae\`).

This is a custom build of [BartmanAbyss's WinUAE fork](https://github.com/BartmanAbyss/WinUAE) with added register and memory write support. See the [patch details](https://github.com/axewater/WinUAE/blob/gdb-write-commands/HANDOVER.md).

### 2. Install the MCP server

```bash
git clone https://github.com/axewater/mcp-winuae-emu.git
cd mcp-winuae-emu
npm install
npm run build
```

### 3. Add to Claude Code

Add to your MCP settings (`~/.claude/claude_desktop_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "winuae-emu": {
      "command": "node",
      "args": ["C:/path/to/mcp-winuae-emu/dist/index.js"],
      "env": {
        "WINUAE_PATH": "C:/apps/winuae",
        "WINUAE_CONFIG": "C:/apps/winuae/Configurations/A500-Dev.uae"
      }
    }
  }
}
```

### 4. Provide a Kickstart ROM and config

You need a valid Amiga Kickstart ROM file (e.g., Kickstart 1.3 for A500) and a WinUAE `.uae` config file. A minimal config:

```ini
cpu_type=68000
chipset=ocs
chipmem_size=1
kickstart_rom_file=C:\path\to\kickstart.rom
```

The server reads your config, merges in GDB-required settings, and launches `winuae-gdb.exe` automatically.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `WINUAE_PATH` | `C:\apps\winuae` | Directory containing `winuae-gdb.exe` |
| `WINUAE_CONFIG` | `<WINUAE_PATH>\Configurations\A500-Dev.uae` | Path to your `.uae` config file |
| `WINUAE_GDB_PORT` | `2345` | GDB server TCP port |
| `WINUAE_DEBUG` | `0` | Set to `1` to enable GDB protocol debug logging |

## Tools

### Connection

| Tool | Description |
|---|---|
| `winuae_connect` | Launch WinUAE and connect to GDB server |
| `winuae_disconnect` | Disconnect and stop the emulator |
| `winuae_status` | Check if connected and responsive |

### Memory

| Tool | Description |
|---|---|
| `winuae_memory_read` | Read memory bytes as hex |
| `winuae_memory_write` | Write hex bytes to memory |
| `winuae_memory_dump` | Hex + ASCII dump (like a hex editor) |
| `winuae_load` | Load a binary file into Amiga memory |

### CPU

| Tool | Description |
|---|---|
| `winuae_registers_get` | Read all m68k registers (D0-D7, A0-A7, SR, PC) |
| `winuae_registers_set` | Write registers (any subset of D0-D7, A0-A7, SR, PC) |
| `winuae_step` | Single-step N instructions |
| `winuae_continue` | Resume execution |
| `winuae_pause` | Pause execution and read registers |
| `winuae_reset` | Pause CPU and read current register state |

### Breakpoints & Watchpoints

| Tool | Description |
|---|---|
| `winuae_breakpoint_set` | Set a software breakpoint at an address |
| `winuae_breakpoint_clear` | Remove a breakpoint |
| `winuae_watchpoint_set` | Break on memory read/write/access |
| `winuae_watchpoint_clear` | Remove a watchpoint |

### Amiga Hardware

| Tool | Description |
|---|---|
| `winuae_custom_registers` | Read and decode all custom chip registers ($DFF000-$DFF1FE) |
| `winuae_copper_disassemble` | Decode a Copper list (WAIT, MOVE, SKIP, END) |
| `winuae_disassemble` | Basic m68k disassembly |

## How it works

1. **Launch**: Reads your `.uae` config, merges GDB settings, spawns `winuae-gdb.exe -portable -G -s debugging_features=gdbserver -s debugging_trigger=`
2. **Connect**: Retries TCP connection to `localhost:2345` until the GDB server is ready
3. **Protocol**: Communicates via [GDB RSP](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Remote-Protocol.html) -- packet framing, checksums, ack mode, register/memory commands, breakpoint commands, etc.

### Technical notes

- The `-G` flag and `-s` overrides **must** be CLI arguments. This WinUAE build (v4.10.1) ignores `use_gui` and `debugging_features` when set in the config file.
- The GDB server sends `O` packets (console output) on connect. The protocol handler skips these automatically.
- Custom chip register reads use 64-byte chunks because the GDB server has read-size limits for hardware I/O addresses.
- ECS/AGA-only registers ($DFF1C0+) return zeros on OCS chipset configurations.
- CIA registers ($BFE001/$BFD000) are not accessible through the GDB memory read interface.

## Credits

- [WinUAE](https://www.winuae.net/) by Toni Wilen -- the Amiga emulator
- [BartmanAbyss WinUAE fork](https://github.com/BartmanAbyss/WinUAE) -- added the GDB server to WinUAE
- [vscode-amiga-debug](https://github.com/BartmanAbyss/vscode-amiga-debug) by BartmanAbyss -- the VSCode extension that pioneered Amiga GDB debugging, and the reference for this work
- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic

## Limitations

- **Windows only** -- requires WinUAE
- **Basic disassembly** -- the disassembler only recognizes a few opcodes (RTS, NOP, RTE, etc.); all others show as `DC.W`
- **No CIA access** -- CIA-A/CIA-B registers are not mapped through the GDB server
- **Single connection** -- the GDB server accepts one client at a time

## License

MIT
