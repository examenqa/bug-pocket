#Requires -Version 5.1
# Source preparation only: this script was NOT RUN in the owner account.
# Later authorised QA compilation uses existing, separately approved inputs.
# No tool/header acquisition, npm, node-gyp, project hooks or addon loading.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ElectronIncludeDirectory,
    [Parameter(Mandatory = $true)] [string] $ElectronNodeLibrary,
    [Parameter(Mandatory = $true)] [string] $MsvcToolsDirectory,
    [Parameter(Mandatory = $true)] [string] $WindowsSdkDirectory,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^10\.0\.\d+\.0$')] [string] $WindowsSdkVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$actualAccount = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$actualProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
if ($actualAccount -ine 'AMIGO\BugPocketQA' -or
    $actualProfile -ine 'C:\Users\BugPocketQA' -or
    $env:USERPROFILE -ine 'C:\Users\BugPocketQA' -or
    -not [Environment]::Is64BitProcess) {
    throw 'Store startup compilation requires the actual BugPocketQA account/profile and a 64-bit host. No compiler was started.'
}
$actualEngine = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
if ($actualEngine -ine 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe') {
    throw 'Use the existing 64-bit Windows PowerShell host recorded in the QA handoff.'
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($projectRoot -ine 'C:\MyApps\BugPocket-exa66-45-2-1') {
    throw 'Use the existing reviewed worktree; no alternate source/output root is accepted.'
}
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($package.devDependencies.electron -cne '45.2.1') {
    throw 'The reviewed Electron pin changed. Review native inputs before compiling.'
}
if ([Version]$WindowsSdkVersion -lt [Version]'10.0.19041.0') {
    throw 'Use a separately approved existing Windows 10 SDK at least 10.0.19041.0 with C++/WinRT headers.'
}

function Get-RegularPath([string] $Path, [bool] $Directory = $false) {
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $item = Get-Item -LiteralPath $resolvedPath -Force
    if ($item.PSIsContainer -ne $Directory) {
        throw "Wrong input kind: $resolvedPath"
    }
    $cursor = $item
    while ($null -ne $cursor) {
        if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Linked/reparse build inputs require review: $resolvedPath"
        }
        $cursor = if ($cursor -is [IO.DirectoryInfo]) { $cursor.Parent } else { $cursor.Directory }
    }
    return $resolvedPath
}

function ConvertTo-NativeArgument([AllowEmptyString()] [string] $Argument) {
    # Windows CRT quoting: preserve spaces, embedded quotes and trailing slashes.
    $quoted = [Text.StringBuilder]::new()
    [void]$quoted.Append('"')
    $slashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq '\') { $slashes++; continue }
        if ($character -eq '"') {
            [void]$quoted.Append(('\' * (2 * $slashes + 1)))
            [void]$quoted.Append('"')
        } else {
            [void]$quoted.Append(('\' * $slashes))
            [void]$quoted.Append($character)
        }
        $slashes = 0
    }
    [void]$quoted.Append(('\' * (2 * $slashes)))
    [void]$quoted.Append('"')
    return $quoted.ToString()
}

function Invoke-NativeBuildProcess([string] $FilePath, [string[]] $Arguments, [string] $WorkingDirectory) {
    # ProcessStartInfo.Arguments is available in Windows PowerShell 5.1.
    $commandLine = (@($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    Write-Output "Native command: `"$FilePath`" $commandLine"
    Write-Output "Native working directory: $WorkingDirectory"
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = $commandLine
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "Native process did not start: $FilePath" }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        [Console]::Out.Write($stdout)
        [Console]::Error.Write($stderr)
        if (-not $process.HasExited) { throw "Native process exit status unavailable: $FilePath" }
        $exitCode = $process.ExitCode
        if ($null -eq $exitCode -or $exitCode -isnot [int]) {
            throw "Native process exit status unavailable: $FilePath"
        }
        Write-Output "Native process exit code: $exitCode"
        if ($exitCode -ne 0) { throw "Native process failed ($exitCode): $FilePath. Partial output is preserved." }
    }
    finally {
        $process.Dispose()
    }
}

$electronInclude = Get-RegularPath $ElectronIncludeDirectory $true
$nodeLibrary = Get-RegularPath $ElectronNodeLibrary
if ([IO.Path]::GetFileName($nodeLibrary) -ine 'node.lib') {
    throw 'Supply the separately approved Electron 45.2.1 Windows x64 node.lib, not a Node.js import library.'
}
foreach ($header in @('node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h')) {
    [void](Get-RegularPath (Join-Path $electronInclude $header))
}
# Input existence and paths do not prove release provenance/integrity. The QA
# handoff must establish that these headers and node.lib belong to Electron
# 45.2.1/x64 before this script is authorised. No hashes are invented here.
$msvc = Get-RegularPath $MsvcToolsDirectory $true
$sdk = Get-RegularPath $WindowsSdkDirectory $true
$compilerDirectory = Get-RegularPath (Join-Path $msvc 'bin\Hostx64\x64') $true
$compiler = Get-RegularPath (Join-Path $compilerDirectory 'cl.exe')
$linker = Get-RegularPath (Join-Path $compilerDirectory 'link.exe')
$includeDirectories = @((Get-RegularPath (Join-Path $msvc 'include') $true), $electronInclude)
foreach ($part in @('ucrt', 'shared', 'um', 'winrt', 'cppwinrt')) {
    $includeDirectories += Get-RegularPath (Join-Path $sdk "Include\$WindowsSdkVersion\$part") $true
}
[void](Get-RegularPath (Join-Path $sdk "Include\$WindowsSdkVersion\cppwinrt\winrt\Windows.ApplicationModel.h"))
$libraryDirectories = @(
    (Get-RegularPath (Join-Path $msvc 'lib\x64') $true),
    (Get-RegularPath (Join-Path $sdk "Lib\$WindowsSdkVersion\ucrt\x64") $true),
    (Get-RegularPath (Join-Path $sdk "Lib\$WindowsSdkVersion\um\x64") $true)
)
foreach ($library in @('WindowsApp.lib', 'RuntimeObject.lib', 'kernel32.lib')) {
    [void](Get-RegularPath (Join-Path $libraryDirectories[2] $library))
}
[void](Get-RegularPath (Join-Path $libraryDirectories[0] 'delayimp.lib'))

$nativeRoot = Get-RegularPath (Join-Path $projectRoot 'native\store-startup') $true
$sourceFiles = @(
    (Get-RegularPath (Join-Path $nativeRoot 'store_startup.cc')),
    (Get-RegularPath (Join-Path $nativeRoot 'win_delay_load_hook.cc'))
)
$outputRoot = Join-Path $nativeRoot 'build\Release'
foreach ($directory in @((Join-Path $nativeRoot 'build'), $outputRoot)) {
    if (Test-Path -LiteralPath $directory) { [void](Get-RegularPath $directory $true) }
}
if ((Test-Path -LiteralPath $outputRoot) -and
    (Get-ChildItem -LiteralPath $outputRoot -Force | Select-Object -First 1)) {
    throw 'Build output already contains files. Preserve/review existing or partial results before a separately authorised replacement; this script does not delete or overwrite them.'
}
[void][IO.Directory]::CreateDirectory($outputRoot)
$outputFile = Join-Path $outputRoot 'bug_pocket_store_startup.node'

# Explicit tool paths and a narrow search path avoid inherited CL/LINK option
# injection. Restore this process's environment even on compiler failure.
$environmentNames = @('PATH', 'CL', '_CL_', 'LINK', '_LINK_', 'INCLUDE', 'LIB', 'LIBPATH')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    [Environment]::SetEnvironmentVariable('PATH', "$compilerDirectory;C:\Windows\System32;C:\Windows", 'Process')
    $compileArguments = @(
        '/nologo', '/c', '/std:c++17', '/EHsc', '/O2', '/MT', '/W4', '/utf-8', '/guard:cf',
        '/DWIN32_LEAN_AND_MEAN', '/DNOMINMAX', '/DWINVER=0x0A00', '/D_WIN32_WINNT=0x0A00',
        '/DNAPI_VERSION=8', '/DNODE_GYP_MODULE_NAME=bug_pocket_store_startup'
    )
    foreach ($directory in $includeDirectories) { $compileArguments += "/I$directory" }
    $objects = @()
    foreach ($source in $sourceFiles) {
        $object = Join-Path $outputRoot ([IO.Path]::GetFileNameWithoutExtension($source) + '.obj')
        Invoke-NativeBuildProcess $compiler ($compileArguments + @("/Fo$object", $source)) $projectRoot
        $objects += $object
    }
    $linkArguments = @('/NOLOGO', '/DLL', '/MACHINE:X64', '/INCREMENTAL:NO', '/DYNAMICBASE', '/NXCOMPAT', '/GUARD:CF',
        '/DELAYLOAD:node.exe', "/OUT:$outputFile")
    foreach ($directory in $libraryDirectories) { $linkArguments += "/LIBPATH:$directory" }
    Invoke-NativeBuildProcess $linker ($linkArguments + $objects + @($nodeLibrary, 'delayimp.lib', 'WindowsApp.lib', 'RuntimeObject.lib', 'kernel32.lib')) $projectRoot
    if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf)) { throw 'The linker did not produce the expected fixed addon.' }
    Write-Output "Compiled $outputFile. Addon loading, identity, startup APIs and installed acceptance have NOT been checked."
}
finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
}
