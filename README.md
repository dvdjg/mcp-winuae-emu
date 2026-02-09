# mcp-winuae-emu

An [MCP](https://modelcontextprotocol.io/) server that provides Amiga 68k debugging tools through the WinUAE emulator. It connects to the [BartmanAbyss WinUAE fork](https://github.com/BartmanAbyss/WinUAE) via GDB Remote Serial Protocol (RSP), giving AI assistants direct access to the emulated Amiga hardware.

## What it does

This server lets an AI assistant (Claude, etc.) launch WinUAE, connect to its GDB server, and then read/write memory, inspect registers, set breakpoints, single-step through code, disassemble Copper lists, and more -- all through MCP tool calls.

## Prerequisites

- **Node.js** >= 18
- **WinUAE GDB fork** (`winuae-gdb.exe`) -- the BartmanAbyss build with GDB server support. Get it from the [vscode-amiga-debug](https://github.com/BartmanAbyss/vscode-amiga-debug) extension's `bin/win32` directory.
- **Kickstart ROM** -- a valid Amiga Kickstart ROM file (e.g., Kickstart 1.3 for A500)
- **Windows** -- WinUAE is Windows-only (Linux/macOS users can try Wine)

## Installation

```bash
git clone <repo-url>
cd mcp-winuae-emu
npm install
npm run build
```

## Configuration

The server is configured via environment variables:

| Variable | Default | Description |
|---|---|---|
| `WINUAE_PATH` | `C:\apps\winuae` | Directory containing `winuae-gdb.exe` |
| `WINUAE_CONFIG` | `<WINUAE_PATH>\Configurations\A500-Dev.uae` | Path to your `.uae` config file |
| `WINUAE_GDB_PORT` | `2345` | GDB server TCP port |
| `WINUAE_DEBUG` | `0` | Set to `1` to enable GDB protocol debug logging |

### WinUAE config file

Create a standard WinUAE `.uae` config file with your hardware settings (CPU, chipset, memory, ROM path, display, filesystem mounts, etc.). The server reads this file and generates a `default.uae` alongside `winuae-gdb.exe` at launch time, merging in the required GDB settings automatically.

A minimal config needs at least:

```ini
cpu_type=68000
chipset=ocs
chipmem_size=1
kickstart_rom_file=C:\path\to\kickstart.rom
```

### Adding to Claude Code

Add to your Claude Code MCP settings (`~/.claude/claude_desktop_config.json` or project `.mcp.json`):

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

## Tools

### Connection

| Tool | Description |
|---|---|
| `winuae_connect` | Launch WinUAE and connect to GDB server. Tries an existing instance first, then launches if needed. |
| `winuae_disconnect` | Disconnect and stop the emulator. |
| `winuae_status` | Check if connected and responsive. |

### Memory

| Tool | Description |
|---|---|
| `winuae_memory_read` | Read memory bytes as hex. |
| `winuae_memory_write` | Write hex bytes to memory. |
| `winuae_memory_dump` | Hex + ASCII dump (like a hex editor). |
| `winuae_load` | Load a binary file into Amiga memory. |

### CPU

| Tool | Description |
|---|---|
| `winuae_registers_get` | Read all m68k registers (D0-D7, A0-A7, SR, PC). |
| `winuae_registers_set` | Write any subset of registers. |
| `winuae_step` | Single-step N instructions. |
| `winuae_continue` | Resume execution until breakpoint/watchpoint. |
| `winuae_pause` | Pause execution. |
| `winuae_reset` | Pause and read current state. |

### Breakpoints & Watchpoints

| Tool | Description |
|---|---|
| `winuae_breakpoint_set` | Set a software breakpoint at an address. |
| `winuae_breakpoint_clear` | Remove a breakpoint. |
| `winuae_watchpoint_set` | Break on memory read/write/access. |
| `winuae_watchpoint_clear` | Remove a watchpoint. |

### Amiga Hardware

| Tool | Description |
|---|---|
| `winuae_custom_registers` | Read and decode all custom chip registers ($DFF000-$DFF1FE). |
| `winuae_copper_disassemble` | Decode a Copper list (WAIT, MOVE, SKIP, END). |
| `winuae_disassemble` | Basic m68k disassembly (raw words with known opcode decode). |

## How it works

1. **Launch**: The server reads your `.uae` config, merges GDB-required settings, writes a `default.uae`, and spawns `winuae-gdb.exe -portable -G -s debugging_features=gdbserver -s debugging_trigger=`
2. **Connect**: Retries TCP connection to `localhost:2345` until the GDB server is ready
3. **Protocol**: Communicates via [GDB RSP](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Remote-Protocol.html) -- packet framing, checksums, ack mode, register/memory commands, breakpoint commands, etc.

### Technical notes

- The `-G` flag and `-s` overrides **must** be CLI arguments. This WinUAE build (v4.10.1) ignores `use_gui` and `debugging_features` when set in the config file.
- The GDB server sends `O` packets (console output) on connect. The protocol handler skips these automatically.
- Custom chip register reads use 64-byte chunks because the GDB server has read-size limits for hardware I/O addresses.
- ECS/AGA-only registers ($DFF1C0+) return zeros on OCS chipset configurations.
- CIA registers ($BFE001/$BFD000) are not accessible through the GDB memory read interface.

## Limitations

- **Windows only** -- requires WinUAE
- **Basic disassembly** -- the disassembler only recognizes a few opcodes (RTS, NOP, RTE, etc.); all others show as `DC.W`
- **No CIA access** -- CIA-A/CIA-B registers are not mapped through the GDB server
- **Single connection** -- the GDB server accepts one client at a time

## License

MIT
