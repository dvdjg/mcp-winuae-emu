import { execFileSync } from 'child_process';

export interface WinUAEWindowCaptureResult {
  filepath: string;
  processId: number;
  method: 'printwindow' | 'screen_copy';
  width: number;
  height: number;
  title: string;
  captureRegion: 'window' | 'client';
  sourceWidth: number;
  sourceHeight: number;
  cropLeft: number;
  cropTop: number;
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
using System.Text;
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

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  public const int PW_CLIENTONLY = 0x00000001;
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

$windowRect = New-Object WinUaeCaptureNative+RECT
if (-not [WinUaeCaptureNative]::GetWindowRect($hWnd, [ref]$windowRect)) {
  throw 'GetWindowRect failed for the WinUAE window.'
}

$windowWidth = [Math]::Max(1, $windowRect.Right - $windowRect.Left)
$windowHeight = [Math]::Max(1, $windowRect.Bottom - $windowRect.Top)
$captureRegion = 'window'
$cropLeft = 0
$cropTop = 0
$cropWidth = $windowWidth
$cropHeight = $windowHeight
$clientScreenLeft = $windowRect.Left
$clientScreenTop = $windowRect.Top

$clientRect = New-Object WinUaeCaptureNative+RECT
if ([WinUaeCaptureNative]::GetClientRect($hWnd, [ref]$clientRect)) {
  $origin = New-Object WinUaeCaptureNative+POINT
  $origin.X = 0
  $origin.Y = 0
  if ([WinUaeCaptureNative]::ClientToScreen($hWnd, [ref]$origin)) {
    $captureRegion = 'client'
    $cropLeft = [Math]::Max(0, $origin.X - $windowRect.Left)
    $cropTop = [Math]::Max(0, $origin.Y - $windowRect.Top)
    $cropWidth = [Math]::Max(1, $clientRect.Right - $clientRect.Left)
    $cropHeight = [Math]::Max(1, $clientRect.Bottom - $clientRect.Top)
    $clientScreenLeft = $origin.X
    $clientScreenTop = $origin.Y
  }
}

$bestChildRect = $null
$bestChildArea = 0
$bestChildClass = ''

$childCollector = [WinUaeCaptureNative+EnumWindowsProc]{
  param([IntPtr]$childHwnd, [IntPtr]$lParam)

  if (-not [WinUaeCaptureNative]::IsWindowVisible($childHwnd)) {
    return $true
  }

  $childRect = New-Object WinUaeCaptureNative+RECT
  if (-not [WinUaeCaptureNative]::GetWindowRect($childHwnd, [ref]$childRect)) {
    return $true
  }

  $childWidth = $childRect.Right - $childRect.Left
  $childHeight = $childRect.Bottom - $childRect.Top
  if ($childWidth -le 32 -or $childHeight -le 32) {
    return $true
  }

  $area = $childWidth * $childHeight
  if ($area -le $bestChildArea) {
    return $true
  }

  $classBuilder = New-Object System.Text.StringBuilder 256
  [void][WinUaeCaptureNative]::GetClassName($childHwnd, $classBuilder, $classBuilder.Capacity)

  $bestChildArea = $area
  $bestChildRect = $childRect
  $bestChildClass = $classBuilder.ToString()
  return $true
}

[WinUaeCaptureNative]::EnumChildWindows($hWnd, $childCollector, [IntPtr]::Zero) | Out-Null

if ($bestChildRect -ne $null) {
  $captureRegion = 'client'
  $cropLeft = [Math]::Max(0, $bestChildRect.Left - $windowRect.Left)
  $cropTop = [Math]::Max(0, $bestChildRect.Top - $windowRect.Top)
  $cropWidth = [Math]::Max(1, $bestChildRect.Right - $bestChildRect.Left)
  $cropHeight = [Math]::Max(1, $bestChildRect.Bottom - $bestChildRect.Top)
  $clientScreenLeft = $bestChildRect.Left
  $clientScreenTop = $bestChildRect.Top
}

$bitmap = New-Object System.Drawing.Bitmap($windowWidth, $windowHeight)
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
if ($captureRegion -ne 'client') {
  $hdc = $graphics.GetHdc()
  try {
    $printed = [WinUaeCaptureNative]::PrintWindow($hWnd, $hdc, 0)
  } finally {
    $graphics.ReleaseHdc($hdc)
  }
}

if ($printed -and -not (Test-MostlyBlackBitmap -Bitmap $bitmap)) {
  $method = 'printwindow'
} else {
  $bitmap.Dispose()
  $graphics.Dispose()
  $fallbackWidth = $windowWidth
  $fallbackHeight = $windowHeight
  $fallbackLeft = $windowRect.Left
  $fallbackTop = $windowRect.Top
  if ($captureRegion -eq 'client') {
    $fallbackWidth = $cropWidth
    $fallbackHeight = $cropHeight
    $fallbackLeft = $clientScreenLeft
    $fallbackTop = $clientScreenTop
  }
  $bitmap = New-Object System.Drawing.Bitmap($fallbackWidth, $fallbackHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($fallbackLeft, $fallbackTop, 0, 0, $bitmap.Size)
  $method = 'screen_copy'
  if ($captureRegion -eq 'client') {
    $windowWidth = $fallbackWidth
    $windowHeight = $fallbackHeight
    $cropLeft = 0
    $cropTop = 0
  }
}

$outputBitmap = $bitmap
if ($captureRegion -eq 'client') {
  $cropRect = New-Object System.Drawing.Rectangle($cropLeft, $cropTop, $cropWidth, $cropHeight)
  $outputBitmap = $bitmap.Clone($cropRect, $bitmap.PixelFormat)
}

$outPath = '${quotedPath}'
$outputBitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$outputBitmap.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

@{
  filepath = $outPath
  processId = $proc.Id
  method = $method
  width = $cropWidth
  height = $cropHeight
  title = $proc.MainWindowTitle
  captureRegion = $captureRegion
  sourceWidth = $windowWidth
  sourceHeight = $windowHeight
  cropLeft = $cropLeft
  cropTop = $cropTop
  childClass = $bestChildClass
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
