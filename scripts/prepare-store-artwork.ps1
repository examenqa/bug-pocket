#Requires -Version 5.1
# Existing Windows facilities only. Do not run this script under the owner account.
# This is an artwork/XML helper, not a build, package or application launcher.
[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'Check')]
    [string] $Mode = 'Check'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$actualAccount = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$actualProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
if ($actualAccount -ine 'AMIGO\BugPocketQA' -or
    $actualProfile -ine 'C:\Users\BugPocketQA' -or
    $env:USERPROFILE -ine 'C:\Users\BugPocketQA') {
    throw 'Artwork conversion/checks require AMIGO\BugPocketQA with C:\Users\BugPocketQA. No conversion was started.'
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($projectRoot -ine 'C:\MyApps\BugPocket-exa66-45-2-1') {
    throw 'Use the existing reviewed worktree; no alternate output root is accepted.'
}
$powerShellPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$drawingPath = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.Drawing.dll'
$actualEngine = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
if (-not [Environment]::Is64BitProcess -or $actualEngine -ine $powerShellPath) {
    throw 'Use the existing 64-bit Windows PowerShell command recorded in the packaging report.'
}
$toolPins = @(
    [pscustomobject]@{ Path = $powerShellPath; SHA256 = 'D8F182560210D43BAAF767D482AD1DC1207372522E91413B9D5E515A875E552D' },
    [pscustomobject]@{ Path = $drawingPath; SHA256 = '182431D774D5B55F4C4EEDA285FD61DB39F49349E3673235BD9B3D5FBE865434' }
)
foreach ($toolPin in $toolPins) {
    if ((Get-FileHash -LiteralPath $toolPin.Path -Algorithm SHA256).Hash -ine $toolPin.SHA256) {
        throw 'Existing Windows tool bytes differ from the source-preparation metadata. Inspect the change; do not acquire or substitute tools.'
    }
}

$sourcePath = Join-Path $projectRoot 'src\renderer\public\favicon.png'
$sourceHash = '89D8416E6FFADD613BBC4A785F5834BE6E93517E29860010E1AFE230255227E2'
$outputRoot = Join-Path $projectRoot 'build\appx'
$extensionPath = Join-Path $projectRoot 'build\appx-startup.xml'
$extensionHash = 'E8A275594EEB82EE9F63CB11B21A3AB036C1C3ED8117CB7E30C1C17EAE7B1CF8'
foreach ($fixedPath in @($projectRoot, (Join-Path $projectRoot 'build'),
        (Join-Path $projectRoot 'src'), (Join-Path $projectRoot 'src\renderer'),
        (Join-Path $projectRoot 'src\renderer\public'), $sourcePath, $extensionPath, $outputRoot)) {
    if ((Test-Path -LiteralPath $fixedPath) -and
        ((Get-Item -LiteralPath $fixedPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Linked/reparse build inputs or output directories require review; no files were written.'
    }
}
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ine $sourceHash) {
    throw 'The pinned existing executable-brand PNG changed. Do not redesign or silently substitute it.'
}

$plan = @(
    [pscustomobject]@{ Name = 'StoreLogo.png'; Width = 50; Height = 50; DrawSize = 42; X = 4; Y = 4 },
    [pscustomobject]@{ Name = 'Square150x150Logo.png'; Width = 150; Height = 150; DrawSize = 126; X = 12; Y = 12 },
    [pscustomobject]@{ Name = 'Square44x44Logo.png'; Width = 44; Height = 44; DrawSize = 36; X = 4; Y = 4 },
    [pscustomobject]@{ Name = 'Wide310x150Logo.png'; Width = 310; Height = 150; DrawSize = 126; X = 92; Y = 12 }
)
foreach ($item in $plan) {
    $outputPath = Join-Path $outputRoot $item.Name
    if ((Test-Path -LiteralPath $outputPath) -and
        ((Get-Item -LiteralPath $outputPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'A linked output is not accepted.'
    }
    if ($Mode -eq 'Prepare' -and (Test-Path -LiteralPath $outputPath)) {
        throw 'Prepare never overwrites assets. Inspect existing/partial results and use Check; do not delete or replace them automatically.'
    }
}

if ((Get-FileHash -LiteralPath $extensionPath -Algorithm SHA256).Hash -ine $extensionHash) {
    throw 'The exact reviewed startup fragment changed. Preserve it and review; do not broaden the check silently.'
}

# Parse the extension fragment with its real wrapper namespace; no DTD/network.
$readerSettings = [System.Xml.XmlReaderSettings]::new()
$readerSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$readerSettings.XmlResolver = $null
$fragment = [IO.File]::ReadAllText($extensionPath)
$xmlText = '<Extensions xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10">' + $fragment + '</Extensions>'
$stringReader = [System.IO.StringReader]::new($xmlText)
$xmlReader = [Xml.XmlReader]::Create($stringReader, $readerSettings)
$document = [System.Xml.XmlDocument]::new()
$document.XmlResolver = $null
try { $document.Load($xmlReader) }
finally { $xmlReader.Dispose(); $stringReader.Dispose() }
$namespaces = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
$namespaces.AddNamespace('desktop', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10')
$extensions = $document.SelectNodes('/Extensions/desktop:Extension', $namespaces)
$tasks = $document.SelectNodes('/Extensions/desktop:Extension/desktop:StartupTask', $namespaces)
if ($extensions.Count -ne 1 -or $tasks.Count -ne 1 -or
    $extensions[0].GetAttribute('Category') -cne 'windows.startupTask' -or
    $extensions[0].GetAttribute('Executable') -cne 'app\Bug Pocket.exe' -or
    $extensions[0].GetAttribute('EntryPoint') -cne 'Windows.FullTrustApplication' -or
    $tasks[0].GetAttribute('TaskId') -cne 'BugPocketStartup' -or
    $tasks[0].GetAttribute('Enabled') -cne 'false') {
    throw 'The startup fragment differs from the reviewed declaration. No application/manifest was generated.'
}

[void][Reflection.Assembly]::LoadFrom($drawingPath)
$source = [Drawing.Image]::FromFile($sourcePath)
$rendered = [System.Collections.Generic.List[object]]::new()
try {
    if ($source.Width -ne 256 -or $source.Height -ne 256) {
        throw 'The existing pinned square source has unexpected dimensions.'
    }
    if ($Mode -eq 'Prepare') {
        foreach ($item in $plan) {
            $bitmap = [System.Drawing.Bitmap]::new([int]$item.Width, [int]$item.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $graphics = $null
            $attributes = $null
            $memory = $null
            try {
                $bitmap.SetResolution(96, 96)
                $graphics = [Drawing.Graphics]::FromImage($bitmap)
                $graphics.Clear([Drawing.Color]::Transparent)
                $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
                $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
                $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
                $rectangle = [System.Drawing.Rectangle]::new([int]$item.X, [int]$item.Y, [int]$item.DrawSize, [int]$item.DrawSize)
                $graphics.DrawImage($source, $rectangle, 0, 0, $source.Width, $source.Height,
                    [Drawing.GraphicsUnit]::Pixel, $attributes)
                $memory = [System.IO.MemoryStream]::new()
                $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
                $rendered.Add([pscustomobject]@{ Item = $item; Bytes = $memory.ToArray() })
            }
            finally {
                if ($memory) { $memory.Dispose() }
                if ($attributes) { $attributes.Dispose() }
                if ($graphics) { $graphics.Dispose() }
                $bitmap.Dispose()
            }
        }
        # Render all four in memory first. CreateNew refuses races/overwrites.
        if (-not (Test-Path -LiteralPath $outputRoot)) {
            [void][IO.Directory]::CreateDirectory($outputRoot)
        }
        foreach ($result in $rendered) {
            $outputPath = Join-Path $outputRoot $result.Item.Name
            $file = [IO.File]::Open($outputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $file.Write($result.Bytes, 0, $result.Bytes.Length) }
            finally { $file.Dispose() }
        }
    }
}
finally { $source.Dispose() }

$assetResults = @()
foreach ($item in $plan) {
    $outputPath = Join-Path $outputRoot $item.Name
    $bitmap = [System.Drawing.Bitmap]::new($outputPath)
    try {
        if ($bitmap.RawFormat.Guid -ne ([System.Drawing.Imaging.ImageFormat]::Png).Guid) {
            throw 'An asset is not a decoded PNG, regardless of its filename.'
        }
        if ($bitmap.Width -ne $item.Width -or $bitmap.Height -ne $item.Height) {
            throw 'An asset has unexpected pixel dimensions.'
        }
        $alphas = @(
            [int]($bitmap.GetPixel(0, 0).A)
            [int]($bitmap.GetPixel(($bitmap.Width - 1), 0).A)
            [int]($bitmap.GetPixel(0, ($bitmap.Height - 1)).A)
            [int]($bitmap.GetPixel(($bitmap.Width - 1), ($bitmap.Height - 1)).A)
        )
        if (@($alphas | Where-Object { $_ -ne 0 }).Count -ne 0) {
            throw 'An asset lost the planned transparent corner padding.'
        }
        $assetResults += [pscustomobject]@{
            Name = $item.Name; Width = $bitmap.Width; Height = $bitmap.Height
            PlannedDrawSize = $item.DrawSize; PlannedX = $item.X; PlannedY = $item.Y
            PixelFormat = $bitmap.PixelFormat.ToString()
            CornerAlpha = $alphas; DpiX = $bitmap.HorizontalResolution; DpiY = $bitmap.VerticalResolution
            Bytes = (Get-Item -LiteralPath $outputPath).Length
            SHA256 = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash
        }
    }
    finally { $bitmap.Dispose() }
}
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ine $sourceHash) {
    throw 'Source bytes changed during artwork work; preserve outputs and inspect.'
}
[pscustomobject]@{
    Account = $actualAccount; Profile = $actualProfile; Mode = $Mode
    Source = 'src/renderer/public/favicon.png'; SourceSHA256 = $sourceHash
    StartupFragmentChecked = $true; StartupFragmentSHA256 = $extensionHash
    Assets = $assetResults
    VisualLegibility = 'PENDING: inspect each final PNG at native pixel size; these checks do not establish legibility.'
    Limits = 'No config import, builder, Electron, native app binding, package, network or provider call. Partial outputs are retained on failure; no automatic deletion/overwrite.'
} | ConvertTo-Json -Depth 5
