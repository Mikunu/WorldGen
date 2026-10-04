[CmdletBinding()]
param(
    [switch]$AllowStable
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$versionTool = Join-Path $PSScriptRoot 'set-version.mjs'
$metadataText = & node $versionTool --check
if ($LASTEXITCODE -ne 0) { throw 'Version metadata validation failed.' }
try { $metadata = ($metadataText | Out-String | ConvertFrom-Json) } catch { throw 'Version tool returned invalid metadata.' }
$version = [string]$metadata.version
$isAlpha = [bool]$metadata.alpha
$isPrerelease = [bool]$metadata.preRelease
if ($isPrerelease) {
    if (-not $isAlpha -or [int]$metadata.major -ne 0) { throw 'Pre-1.0 desktop releases must use 0.x.y-alpha.N.' }
} elseif ([int]$metadata.major -eq 0) {
    throw 'A 0.x desktop release must use the alpha channel.'
} elseif (-not $AllowStable) {
    throw 'A stable release requires explicit readiness: run prepare-release.ps1 -AllowStable after user approval.'
}

$notesRelative = "docs/releases/v$version.md"
$notesPath = Join-Path $projectRoot $notesRelative
if (-not (Test-Path -LiteralPath $notesPath -PathType Leaf)) { throw "Release notes missing: $notesRelative" }
$title = (Get-Content -LiteralPath $notesPath -Encoding UTF8 -TotalCount 1) -replace '^#\s+', ''
$quickstartPath = Join-Path $projectRoot 'docs/releases/windows-quickstart.md'
if ((Get-Content -LiteralPath $quickstartPath -Encoding UTF8 -TotalCount 1) -notmatch [regex]::Escape($version)) { throw 'Portable README version differs.' }

$targetBinary = Join-Path $projectRoot 'src-tauri/target/release/worldgen.exe'
$defaultBinary = Join-Path $projectRoot 'release/WorldGen.exe'
$versionedBinary = Join-Path $projectRoot "release/WorldGen_$version.exe"
$installerName = "WorldGen_${version}_x64-setup.exe"
$installerTarget = Join-Path $projectRoot "src-tauri/target/release/bundle/nsis/$installerName"
$installerPath = if (Test-Path -LiteralPath $installerTarget -PathType Leaf) { $installerTarget } else { Join-Path $projectRoot "release/$installerName" }
foreach ($artifactPath in @($targetBinary, $defaultBinary, $versionedBinary, $installerPath)) {
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Build artifact missing: $artifactPath. Run build.cmd first." }
}

$targetHash = (Get-FileHash -LiteralPath $targetBinary -Algorithm SHA256).Hash.ToLowerInvariant()
foreach ($artifactPath in @($defaultBinary, $versionedBinary)) {
    $artifactHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($artifactHash -ne $targetHash) { throw "Executable differs from src-tauri target output: $artifactPath" }
}

function Assert-WindowsProductVersion([string]$ArtifactPath) {
    $actual = [string](Get-Item -LiteralPath $ArtifactPath).VersionInfo.ProductVersion
    if ([string]::IsNullOrWhiteSpace($actual)) { throw "Binary ProductVersion missing: $ArtifactPath" }
    if ($actual -eq $version) { return }
    throw "Binary version differs: $ArtifactPath ($actual; expected $version)"
}
Assert-WindowsProductVersion $targetBinary
Assert-WindowsProductVersion $defaultBinary
Assert-WindowsProductVersion $versionedBinary
Assert-WindowsProductVersion $installerPath

$releaseRoot = Join-Path $projectRoot 'release'
$stagingPath = Join-Path $releaseRoot ('.package-' + [guid]::NewGuid().ToString('N'))
$resolvedStagingPath = [IO.Path]::GetFullPath($stagingPath)
if (-not $resolvedStagingPath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Staging directory must stay inside release/.' }
New-Item -ItemType Directory -Path $stagingPath | Out-Null
try {
    Copy-Item -LiteralPath $defaultBinary -Destination (Join-Path $stagingPath 'WorldGen.exe')
    Copy-Item -LiteralPath $quickstartPath -Destination (Join-Path $stagingPath 'README.md')
    $zipName = "WorldGen_${version}_windows-x64.zip"
    $zipPath = Join-Path $releaseRoot $zipName
    Compress-Archive -LiteralPath (Join-Path $stagingPath 'WorldGen.exe'), (Join-Path $stagingPath 'README.md') -DestinationPath $zipPath -CompressionLevel Optimal -Force
    $installerDestination = Join-Path $releaseRoot $installerName
    if ([IO.Path]::GetFullPath($installerPath) -ne [IO.Path]::GetFullPath($installerDestination)) { Copy-Item -LiteralPath $installerPath -Destination $installerDestination -Force }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $actualNames = @($archive.Entries | ForEach-Object FullName | Sort-Object)
        if (($actualNames -join '|') -ne 'README.md|WorldGen.exe') { throw "Unexpected archive contents: $actualNames" }
        $entryStream = $archive.GetEntry('WorldGen.exe').Open()
        $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
        try { $insideHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($entryStream)).Replace('-', '').ToLowerInvariant() }
        finally { $hashAlgorithm.Dispose(); $entryStream.Dispose() }
        if ($insideHash -ne $targetHash) { throw 'ZIP executable differs from the target executable.' }
    } finally { $archive.Dispose() }

    $assets = @($zipName, $installerName) | ForEach-Object {
        $assetPath = Join-Path $releaseRoot $_
        [ordered]@{ name = $_; bytes = (Get-Item -LiteralPath $assetPath).Length; sha256 = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $checksumText = (($assets | ForEach-Object { "$($_.sha256)  $($_.name)" }) -join "`n") + "`n"
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'SHA256SUMS.txt'), $checksumText, $utf8)
    Copy-Item -LiteralPath $notesPath -Destination (Join-Path $releaseRoot 'RELEASE-NOTES.md') -Force
    $manifest = [ordered]@{
        tag = "v$version"; title = $title; prerelease = $isPrerelease; state = 'prepared-locally';
        target = 'windows-x64'; notes = $notesRelative; assets = @($assets);
        checksums = 'SHA256SUMS.txt'; portableExecutableSha256 = $targetHash;
        windowsProductVersion = [string](Get-Item -LiteralPath $targetBinary).VersionInfo.ProductVersion;
        windowsNumericVersion = [string]$metadata.windowsVersion;
        installerProductVersion = [string](Get-Item -LiteralPath $installerPath).VersionInfo.ProductVersion
    }
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'release-manifest.json'), ($manifest | ConvertTo-Json -Depth 6) + "`n", $utf8)
    $assets | ForEach-Object { Write-Output "$($_.name): $($_.bytes) bytes, SHA256 $($_.sha256)" }
    Write-Output "Prepared locally: $releaseRoot"
} finally {
    if ([IO.Path]::GetFullPath($stagingPath) -ne $resolvedStagingPath -or -not $resolvedStagingPath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing staging cleanup outside release/.' }
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
}
