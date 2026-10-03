[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/tauri.conf.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric major.minor.patch version.' }
if ($version -ne [string]$config.version) { throw 'package.json and tauri.conf.json versions differ.' }
$cargo = Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/Cargo.toml') -Encoding UTF8 -Raw
$cargoVersion = [regex]::Match($cargo, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
if ($version -ne $cargoVersion) { throw 'Cargo.toml version differs.' }

$notesRelative = "docs/releases/v$version.md"
$notesPath = Join-Path $projectRoot $notesRelative
if (-not (Test-Path -LiteralPath $notesPath -PathType Leaf)) { throw "Release notes missing: $notesRelative" }
$title = (Get-Content -LiteralPath $notesPath -Encoding UTF8 -TotalCount 1) -replace '^#\s+', ''
$quickstartPath = Join-Path $projectRoot 'docs/releases/windows-quickstart.md'
if ((Get-Content -LiteralPath $quickstartPath -Encoding UTF8 -TotalCount 1) -notmatch [regex]::Escape($version)) { throw 'Portable README version differs.' }
$binaryPath = Join-Path $projectRoot 'release/WorldGen.exe'
$installerName = "WorldGen_${version}_x64-setup.exe"
$installerPath = Join-Path $projectRoot "src-tauri/target/release/bundle/nsis/$installerName"
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { $installerPath = Join-Path $projectRoot "release/$installerName" }
foreach ($artifactPath in @($binaryPath, $installerPath)) {
    if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) { throw "Build artifact missing: $artifactPath. Run build.cmd first." }
    $binaryVersion = (Get-Item -LiteralPath $artifactPath).VersionInfo.ProductVersion
    if ($binaryVersion -and -not $binaryVersion.StartsWith($version)) { throw "Binary version differs: $artifactPath ($binaryVersion)" }
}

$releaseRoot = Join-Path $projectRoot 'release'
$stagingPath = Join-Path $releaseRoot ('.package-' + [guid]::NewGuid().ToString('N'))
$resolvedStagingPath = [IO.Path]::GetFullPath($stagingPath)
if (-not $resolvedStagingPath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Staging directory must stay inside release/.' }
New-Item -ItemType Directory -Path $stagingPath | Out-Null
try {
    Copy-Item -LiteralPath $binaryPath -Destination (Join-Path $stagingPath 'WorldGen.exe')
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
        $binaryHash = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($insideHash -ne $binaryHash) { throw 'ZIP executable differs from the built executable.' }
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
        tag = "v$version"; title = $title; prerelease = $true; state = 'prepared-locally';
        target = 'windows-x64'; notes = $notesRelative; assets = @($assets);
        checksums = 'SHA256SUMS.txt'; portableExecutableSha256 = $binaryHash
    }
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'release-manifest.json'), ($manifest | ConvertTo-Json -Depth 6) + "`n", $utf8)
    $assets | ForEach-Object { Write-Output "$($_.name): $($_.bytes) bytes, SHA256 $($_.sha256)" }
    Write-Output "Prepared locally: $releaseRoot"
} finally {
    # This exact fresh directory is validated before recursive cleanup; user files stay outside it.
    if ([IO.Path]::GetFullPath($stagingPath) -ne $resolvedStagingPath -or -not $resolvedStagingPath.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing staging cleanup outside release/.' }
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
}
