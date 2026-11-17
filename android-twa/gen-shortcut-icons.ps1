# Generates the TWA shortcut icon PNGs (app/src/main/res/drawable/).
# Simple brand-colored glyphs; replaced freely if real icon assets arrive.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\client\public\assets'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-ShortcutIcon {
  param([string]$Name, [scriptblock]$Draw)
  $size = 108
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  # rounded-rect tile
  $tileBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 48, 52, 56))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 26
  $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $path.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath($tileBrush, $path)
  & $Draw $g
  $g.Dispose()
  $outPath = Join-Path $outDir "$Name.png"
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "wrote $outPath"
}

$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$blue = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 91, 140, 255))

# new chat: plus sign
New-ShortcutIcon -Name 'ic_shortcut_chat' -Draw {
  param($g)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 9)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawLine($pen, 54, 30, 54, 78)
  $g.DrawLine($pen, 30, 54, 78, 54)
  $pen.Dispose()
}

# voice: mic capsule + stand
New-ShortcutIcon -Name 'ic_shortcut_voice' -Draw {
  param($g)
  $g.FillEllipse($blue, 40, 26, 28, 44)  # capsule via rounded rect
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 8)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawLine($pen, 54, 70, 54, 84)
  $g.DrawArc($pen, 36, 52, 36, 30, 0, 180)
  $pen.Dispose()
}

# marketplace: 2x2 grid
New-ShortcutIcon -Name 'ic_shortcut_market' -Draw {
  param($g)
  foreach ($p in @(@(32, 32), @(60, 32), @(32, 60), @(60, 60))) {
    $g.FillEllipse($white, $p[0], $p[1], 16, 16)
  }
}

Write-Host 'done'
