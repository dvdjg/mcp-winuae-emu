# mcp-winuae-emu

An [MCP](https://modelcontextprotocol.io/) server that provides Amiga 68k debugging and development tools through the WinUAE emulator. It connects to a [custom WinUAE fork](https://github.com/axewater/WinUAE/tree/gdb-write-commands) or WinUAE-DBG via GDB Remote Serial Protocol (RSP), giving AI assistants direct read-write access to the emulated Amiga hardware.

## What it does

This server lets an AI assistant (Claude, Cursor, etc.) help develop Amiga software (A500, A1200, CD32) by:

- **Launching and debugging**: Load executables, set breakpoints, single-step, read/write memory and registers
- **Capturing output**: Screenshot the emulator display, full m68k disassembly
- **Simulating input**: Inject keyboard events (raw scancodes or WinUAE event IDs)
- **Disk management**: Insert/eject floppy images, load binaries into memory
- **Hardware inspection**: Custom chip registers, Copper list disassembly
- **Structured snapshots**: One-shot JSON capture of CPU/custom state plus bounded RAM windows

All via MCP tool calls, enabling the AI to run, test, and iterate on Amiga programs.

Related project docs:
- Cursor-Amiga-C roadmap: [amiga-implementation-roadmap.md](../Cursor-Amiga-C/doc/amiga-implementation-roadmap.md)
- Cursor-Amiga-C battery/spec: [amiga-test-battery-spec.md](../Cursor-Amiga-C/doc/amiga-test-battery-spec.md)

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
| `WINUAE_USE_ACK` | (unset) | Set to `1` to disable no-ack mode; some stubs need acks for memory write (M) |
| `WINUAE_MEMORY_WRITE_NO_PAUSE` | (unset) | Set to `1` to skip pausing the CPU before write (try with CPU running) |
| `WINUAE_SESSION_IDLE_TIMEOUT_MS` | `0` | Idle timeout for the reusable session. `0` disables auto-disconnect. |
| `WINUAE_SESSION_IDLE_ACTION` | `detach` | On idle timeout: `detach` drops GDB but leaves WinUAE running; `shutdown` also closes the launched emulator process. |

## Tools

### Connection

| Tool | Description |
|---|---|
| `winuae_connect` | Launch WinUAE and connect to GDB server. Optional `config_file` overrides `WINUAE_CONFIG` for this session. Supports non-intrusive attach with `force_break=false` and `initialize_stopped=false`. |
| `winuae_connect_existing` | Attach to GDB on port 2345 (WinUAE already running). Supports non-intrusive attach with `force_break=false` and `initialize_stopped=false`. |
| `winuae_disconnect` | Disconnect from GDB and optionally leave the emulator process running (`stop_emulator=false`) |
| `winuae_status` | Return JSON session status, health, tracked floppies, reusable-session policy, and tracked PID when this MCP launched WinUAE |
| `winuae_session_config` | Configure reusable-session idle timeout and whether idle expiry detaches or shuts WinUAE down |
| `winuae_memory_map` | Return the current memory-bank map parsed from `monitor memcfg` (Chip/Bogo/Fast/Z3 Fast) |
| `winuae_qoffsets` | Return `qOffsets` relocation info for the current AmigaDOS program when the stub provides it |

### Memory

| Tool | Description |
|---|---|
| `winuae_memory_read` | Read memory bytes as hex |
| `winuae_memory_write` | Write hex bytes to memory |
| `winuae_memory_dump` | Hex + ASCII dump (like a hex editor) |
| `winuae_load` | Load a binary file into Amiga memory. For AmigaHunk executables, applies relocations and loads hunks at contiguous addresses. |

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
| `winuae_breakpoint_conditional_wait` | Software-assisted conditional breakpoint helper that evaluates register/custom/memory predicates on each stop until one matches. |
| `winuae_watchpoint_set` | Break on memory read/write/access |
| `winuae_watchpoint_clear` | Remove a watchpoint |

### Amiga Hardware (core tools)

| Tool | Description |
|---|---|
| `winuae_machine_snapshot` | Return a JSON snapshot with CPU registers, custom registers, and optional bounded chip/fast RAM windows. |
| `winuae_postmortem_capture` | Capture a crash/stop postmortem bundle with parsed stop reason, CPU registers, stack dump, disassembly around PC, and optional snapshot data. |
| `winuae_bitmap_decode` | Decode planar bitmap data from Amiga memory to PNG or inline RGBA using palette colors from args or current custom registers. |
| `winuae_memory_pattern_search` | Search a RAM range for an exact byte pattern and optionally score repeated matches using a configurable stride. |
| `winuae_custom_registers` | Read all $DFF000–$DFF1FE with names. Use to get BPL/AUD/DMACON/DIW/DDF/COLOR/SPR/COP1; derive bitmap and sample addresses, then use memory_read to dump. |
| `winuae_copper_disassemble` | Decode Copper list at address (e.g. COP1LCH/L from custom_registers). |
| `winuae_memory_read` | Read any address/length (hex). Use for bitplane dumps, sample dumps, or chunked pattern search. |
| `winuae_memory_write` | Write hex to any address. Use $DFF100 (BPLCON0) or $DFF096 (DMACON) with 2-byte big-endian to toggle bitplanes/sprites. |
| `winuae_memory_dump` | Hex+ASCII dump; inspect regions or search in output. |
| `winuae_disassemble` | Basic m68k disassembly (raw words) |
| `winuae_disassemble_full` | Full m68k disassembly via WinUAE sm68k (requires monitor command support) |

### Capture & Run

| Tool | Description |
|---|---|
| `winuae_screenshot` | Capture display to PNG. `capture_mode=auto` tries WinUAE monitor first and falls back to capturing the visible WinUAE host window. |
| `winuae_run_program` | Load binary into memory, set PC, and start execution. For testing executables. |
| `winuae_exec_chunk` | Write hex-encoded machine code at `address`, set PC (and optional SP/A7), optionally `continue_after`. |
| `winuae_profile` | Run frame profiler for N frames; writes binary with CPU samples, DMA per scanline (CRT/blitter), custom regs, screenshots. Same format as [vscode-amiga-debug](https://github.com/dvdjg/vscode-amiga-debug) Frame/Graphics profiler. |
| `winuae_input_key` | Simulate Amiga keyboard: raw scancode press/release (e.g. 0x45=Return). |
| `winuae_input_event` | Send raw WinUAE input event (event ID from config). Precise control. |
| `winuae_amiga_input_state` | Read and decode Cursor-Amiga-C `g_automation_input` from Amiga memory. |
| `winuae_amiga_input_set` | Drive Cursor-Amiga-C via its software automation buffer with mouse coordinates, buttons, key slot, and joystick flags. |
| `winuae_amiga_enter_demo` | Set `g_automation_enter_demo=1` inside Cursor-Amiga-C to enter the demo/effect path. |

## How it works

1. **Launch**: Reads your `.uae` config, merges GDB settings, spawns `winuae-gdb.exe -portable -G -s debugging_features=gdbserver -s debugging_trigger=`
2. **Connect**: Retries TCP connection to `localhost:2345` until the GDB server is ready
3. **Protocol**: Communicates via [GDB RSP](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Remote-Protocol.html) -- packet framing, checksums, ack mode, register/memory commands, breakpoint commands, etc.

### GDB monitor commands (qRcmd)

When using WinUAE-DBG or Bartman fork with monitor support, the MCP server can send extended commands via `qRcmd`:

| Monitor command | Description |
|---|---|
| `screenshot <path>` | Capture display to PNG file (host path) |
| `disasm <addr> [count]` | Full m68k disassembly at address |
| `input key <scancode> <1\|0>` | Simulate Amiga keyboard (scancode 0x00-0x7F, 1=press 0=release) |
| `input event <event_id> [state]` | Send raw input event (state 1/0/2) |
| `reset` | Restore savestate at process entry (when debugging_trigger set) |
| `profile <n> <unwind> <out>` | Frame profiler: N frames, optional unwind table, output file. Produces same data as vscode-amiga-debug (DMA per scanline, blitter, CRT flow, screenshots). |
| `memcfg` | Dump the current memory-bank map so tools can confirm where Chip/Bogo/Fast RAM are actually mapped before direct loads |

### Frame profiling

The `winuae_profile` tool runs WinUAE’s monitor command `profile` and writes a binary file that contains the same exhaustive data as the [vscode-amiga-debug](https://github.com/dvdjg/vscode-amiga-debug) Frame Profiler and Graphics Debugger: CPU samples, DMA records per scanline (CRT beam position, blitter, bitplanes, sprites), custom chip registers, AGA colors, blitter resources, and a screenshot per frame. You can open the file in the extension’s profiler UI or parse it for autonomous analysis (e.g. from an MCP client).

### What you can do with the core tools (for the AI)

There are no separate “gfx_state”, “audio_state”, “bitmap_read”, “memory_search”, or “custom_write” tools. Use the **core** tools as follows:
- **Consistent machine snapshot**: Call `winuae_machine_snapshot` to get CPU + custom registers in one structured response, with optional chip/fast RAM windows. Each RAM window is capped at **16384 bytes** to keep MCP payloads bounded.
- **Bitmap decode**: Call `winuae_bitmap_decode` with `address`, `width`, `height`, `bitplanes`, and optionally `row_bytes`, `interleaved`, `palette`, or `use_custom_palette=true`. Output can be PNG (`filepath`) or inline RGBA for small images.
- **Crash/postmortem bundle**: Call `winuae_postmortem_capture` after a suspicious stop, requester, or crash to preserve stop reason, CPU, stack, disassembly around PC, and optional custom/chip snapshot data in JSON/Markdown.
- **Pattern search**: Call `winuae_memory_pattern_search` with a RAM range plus `pattern_hex`. Add `stride_bytes` and `repeat_count` when searching repeated row signatures or record layouts; results come back as scored candidates with addresses.
- **Relocatable AmigaHunk load**: `winuae_load` detects classic AmigaHunk executables, assigns contiguous load addresses, applies `RELOC32`, and writes relocated hunks before verification.
- **Memory-map introspection**: Call `winuae_memory_map` before a fixed-address or "metal" load. In the current A500 battery profile, Fast RAM is visible at runtime and should be preferred for bare-metal experiments, but the low end of a bank may still be a bad place to collide with live system allocations.
- **Conditional breakpoints**: `winuae_breakpoint_conditional_wait` uses a normal software breakpoint plus server-side predicate checks on registers, custom registers, or exact memory bytes. The current WinUAE GDB stub does not expose native GDB-expression conditional breakpoints, so this helper is explicitly software-assisted.
- **Software input intermediary**: `winuae_amiga_input_set` writes the `g_automation_input` buffer used by Cursor-Amiga-C, which is more reliable for screen-coordinate mouse movement and scripted UI navigation than blind host-side deltas alone.

- **Graphics extraction**: Call `winuae_custom_registers`; from the output read BPL1PTH/L (offsets 0xE0/0xE2; 24-bit address = high byte of PTH << 16 | PTL), BPLCON0 (0x100; low 3 bits = num bitplanes), DIW/DDF (0x8E–0x94) to compute row_bytes and height. Then call `winuae_memory_read` with that address and length (row_bytes × height × num_planes) to get raw planar data; decode to image externally.
- **Sound extraction**: From `winuae_custom_registers`, read AUD0–3 LCH/LCL (0xA0–0xD2) for 24-bit sample address and LEN (words). Call `winuae_memory_read` at that address with length LEN×2 bytes to get raw 8-bit samples.
- **Toggle bitplanes or sprites** ([coppenheimer](https://github.com/losso3000/coppenheimer)-style): Use `winuae_memory_write` with address $DFF096 (DMACON; clear bit 9 to disable sprites, bit 8 to disable bitplanes) or $DFF100 (BPLCON0) and 2-byte hex value (big-endian, e.g. `0200`).
- **Search memory for a pattern**: Call `winuae_memory_read` in chunks (e.g. 4096 bytes) over the range, then check the returned hex for your pattern; or use `winuae_memory_dump` and search in the text output.
- **Copper list**: Get COP1LCH/L from custom_registers (0x80/0x82), then `winuae_copper_disassemble` at that address.

### Technical notes

- `winuae_machine_snapshot` returns JSON text and caps each optional RAM window at **16 KiB**; requests above that are truncated and marked in the response. It has been live-validated in this workspace against a visible WinUAE session, including CPU/custom capture, a truncated 16 KiB chip RAM window, and region-specific fast RAM errors without breaking the whole snapshot. RAM windows are read in 1 KiB chunks to avoid stub resets on large reads.
- `winuae_postmortem_capture` is intended for postmortem analysis after `winuae_pause`, `winuae_wait_stop`, requesters, or test failures. Its GDB signal-to-exception mapping is heuristic, especially on plain 68000 targets, so treat it as a debugging aid rather than a perfect architectural exception decoder.
- `winuae_bitmap_decode` supports 1–8 bitplanes, row-interleaved or plane-sequential layouts, and can derive palette from custom COLOR registers. Inline RGBA output is limited to **16384 pixels**; use PNG for larger images.
- `winuae_memory_pattern_search` caps the scanned RAM range at **256 KiB**, the pattern at **8 KiB**, and the result list at **64** candidates to keep MCP responses bounded.
- `winuae_load` now supports a practical subset of AmigaHunk (`HEADER`, `CODE`, `DATA`, `BSS`, `RELOC32`, `END`) for typical toolchain outputs. Unsupported hunk block types still fail fast.
- Direct fixed-address Hunk loading is still marked operationally fragile in this workspace: WinUAE-DBG now exposes `memcfg`, and MCP stores memory-map evidence, but the current live T01 route still crashes the emulator process during post-write verification of some Hunk uploads. That is a known debugger/runtime blocker, not yet a closed test path.
- `winuae_breakpoint_conditional_wait` is a server-side loop over ordinary breakpoint hits; it is useful for automation, but it is not the same as native stub-side conditional expressions.
- `winuae_amiga_input_set` depends on the target Amiga program exporting `g_automation_input` (or on you passing `automation_address`). For Cursor-Amiga-C this is now the preferred path for deterministic mouse/keyboard/joystick automation inside the app.
- Reusable sessions are supported: `winuae_connect` already tries an existing GDB server first, and `winuae_session_config` can keep the emulator open across turns with either `detach` or `shutdown` idle behavior. On the current WinUAE build, the most reliable cross-turn reuse is still an externally launched visible session plus `winuae_connect_existing`.
- For visible-session evidence, `winuae_screenshot` with `capture_mode=host_window` is now the most faithful way to see what the user sees on screen. The helper prioritizes desktop `screen_copy` because `PrintWindow` can report success while returning a black frame for WinUAE.
- `npm run test:adf-matrix` runs the reproducible A-MCP-01 verification matrix (`scripts/a-mcp-01-matrix.mjs`) and writes `report.json` plus `report.md` under `test-output/a-mcp-01-matrix/`.
- `npm run test:snapshot-live` runs the live A-MCP-02 validation (`scripts/a-mcp-02-live.mjs`) and writes `a-mcp-02-live-machine-snapshot.json` plus `a-mcp-02-live-validation-summary.json` under `Cursor-Amiga-C/out/`.
- If `dfN insert/eject` fails while attached through `winuae_connect_existing`, MCP now keeps the requested floppy state for the next managed launch instead of silently spawning a replacement WinUAE instance that it does not control.
- Most tools now try a lightweight auto-attach to an already-running WinUAE GDB server before failing with "Not connected", so a visible session from a previous turn can often be reused without an explicit `winuae_connect_existing`.
- `winuae_screenshot` supports `capture_mode=auto|monitor|host_window`. The host-window path is Windows-only and requires a visible WinUAE window, but it gives a practical fallback when the monitor `screenshot` command returns an error such as `E03`.
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
- **Memory write (M packet):** Some WinUAE GDB builds (e.g. prb28/vscode-amiga-assembly) do not implement the GDB **M** (write memory) packet; `winuae_memory_write` may then timeout. This MCP: pauses the CPU before writing (unless `WINUAE_MEMORY_WRITE_NO_PAUSE=1`), uses a 30s timeout, tries **X** (binary write) if **M** fails, and always logs `[GDB memory] [SEND]` / `[RECV]` to stderr so you can see whether the stub replies. You can try `WINUAE_USE_ACK=1` (disable no-ack mode) in case the stub only responds when acks are on. If it still fails, use a WinUAE build with M support (e.g. [axewater fork](https://github.com/axewater/WinUAE/tree/gdb-write-commands)) or drive the target via an in-program automation buffer (Cursor-Amiga-C `engine_automation_input.h`).

## License

MIT
