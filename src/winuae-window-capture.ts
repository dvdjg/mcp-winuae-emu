import { execFileSync } from 'child_process';

export interface WinUAEWindowCaptureResult {
  filepath: string;
  processId: number;
  method: 'printwindow' | 'screen_copy';
  width: number;
  height: number;
  title: string;
}

function buildPowerShellScript(outputPath: string, processId?: number): string {
  const quotedPath = outputPath.replace(/'/g, "''");
  const pidExpr = typeof processId === 'number' && processId > 0 ? String(Math.trunc(processId)) : '0';

  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WinUaeCaptureNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$targetPid = ${pidExpr}
if ($targetPid -gt 0) {
  $proc = Get-Process -Id $targetPid -ErrorAction Stop
} else {
  $proc = Get-Process winuae-gdb -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

if (-not $proc) {
  throw 'No WinUAE window with a main handle is available.'
}

$hWnd = [IntPtr]$proc.MainWindowHandle
if ($hWnd -eq [IntPtr]::Zero) {
  throw 'The selected WinUAE process does not expose a main window handle.'
}

[WinUaeCaptureNative]::ShowWindow($hWnd, 9) | Out-Null
[WinUaeCaptureNative]::SetForegroundWindow($hWnd) | Out-Null
Start-Sleep -Milliseconds 120

$rect = New-Object WinUaeCaptureNative+RECT
if (-not [WinUaeCaptureNative]::GetWindowRect($hWnd, [ref]$rect)) {
  throw 'GetWindowRect failed for the WinUAE window.'
}

$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$method = 'screen_copy'

$outPath = '${quotedPath}'
$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

@{
  filepath = $outPath
  processId = $proc.Id
  method = $method
  width = $width
  height = $height
  title = $proc.MainWindowTitle
} | ConvertTo-Json -Compress
`.trim();
}

export function captureWinUAEWindow(filepath: string, processId?: number): WinUAEWindowCaptureResult {
  const script = buildPowerShellScript(filepath, processId);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  ).trim();
  const jsonLine = output
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .pop();

  if (!jsonLine) {
    throw new Error(`Could not parse WinUAE window capture output: ${output}`);
  }

  return JSON.parse(jsonLine) as WinUAEWindowCaptureResult;
}
