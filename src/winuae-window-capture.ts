import { execFileSync } from 'child_process';

export interface WinUAEWindowCaptureResult {
  filepath: string;
  processId: number;
  method: 'printwindow' | 'screen_copy';
  width: number;
  height: number;
  title: string;
  captureRegion: 'window' | 'client';
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

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
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
$captureRegion = 'window'
if (-not [WinUaeCaptureNative]::GetClientRect($hWnd, [ref]$rect)) {
  if (-not [WinUaeCaptureNative]::GetWindowRect($hWnd, [ref]$rect)) {
    throw 'GetWindowRect failed for the WinUAE window.'
  }
} else {
  $origin = New-Object WinUaeCaptureNative+POINT
  $origin.X = 0
  $origin.Y = 0
  if ([WinUaeCaptureNative]::ClientToScreen($hWnd, [ref]$origin)) {
    $clientWidth = [Math]::Max(1, $rect.Right - $rect.Left)
    $clientHeight = [Math]::Max(1, $rect.Bottom - $rect.Top)
    $rect.Left = $origin.X
    $rect.Top = $origin.Y
    $rect.Right = $origin.X + $clientWidth
    $rect.Bottom = $origin.Y + $clientHeight
    $captureRegion = 'client'
  } elseif (-not [WinUaeCaptureNative]::GetWindowRect($hWnd, [ref]$rect)) {
    throw 'GetWindowRect failed for the WinUAE window.'
  }
}

$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

function Test-MostlyBlackBitmap {
  param(
    [System.Drawing.Bitmap]$Bitmap
  )

  $sampleX = [Math]::Max(1, [int]($Bitmap.Width / 24))
  $sampleY = [Math]::Max(1, [int]($Bitmap.Height / 24))
  $samples = 0
  $dark = 0

  for ($y = 0; $y -lt $Bitmap.Height; $y += $sampleY) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += $sampleX) {
      $pixel = $Bitmap.GetPixel($x, $y)
      $luma = ($pixel.R * 30 + $pixel.G * 59 + $pixel.B * 11) / 100
      if ($luma -lt 8) {
        $dark++
      }
      $samples++
    }
  }

  if ($samples -eq 0) {
    return $false
  }

  return (($dark / $samples) -ge 0.95)
}

$printed = $false
try {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
  $method = 'screen_copy'
} catch {
  $hdc = $graphics.GetHdc()
  try {
    $printed = [WinUaeCaptureNative]::PrintWindow($hWnd, $hdc, 0)
  } finally {
    $graphics.ReleaseHdc($hdc)
  }

  if ($printed -and -not (Test-MostlyBlackBitmap -Bitmap $bitmap)) {
    $method = 'printwindow'
  } else {
    throw
  }
}

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
  captureRegion = $captureRegion
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
