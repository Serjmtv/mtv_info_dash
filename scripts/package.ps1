# Builds tokens-<version>.vsix without Node or vsce: a VSIX is a zip with two XML descriptors.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\package.ps1 [-Install]
param([switch]$Install)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path $PSScriptRoot -Parent
# the webview UI is a React bundle (webview/ -> media/webview.js): rebuild it so a stale bundle never ships
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
Push-Location $root
try { cmd /c "npm run build" | Out-Null; if ($LASTEXITCODE -ne 0) { throw "npm run build failed" } } finally { Pop-Location }
$pkg = Get-Content (Join-Path $root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$out = Join-Path $root "$($pkg.name)-$($pkg.version).vsix"
$files = @("package.json", "extension.js", "README.md") + (Get-ChildItem (Join-Path $root "src"), (Join-Path $root "media") -File | ForEach-Object { "$($_.Directory.Name)/$($_.Name)" })

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$($pkg.description)</Description>
    <Categories>Other</Categories>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" /></Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" /></Assets>
</PackageManifest>
"@
$types = @"
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
"@

if (Test-Path $out) { Remove-Item $out }
$zip = [System.IO.Compression.ZipFile]::Open($out, "Create")
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($pair in @(@("extension.vsixmanifest", $manifest), @("[Content_Types].xml", $types))) {
        $w = New-Object System.IO.StreamWriter($zip.CreateEntry($pair[0]).Open(), $utf8)
        $w.Write($pair[1]); $w.Close()
    }
    # Forward slashes in entry names: VS Code rejects backslash paths.
    foreach ($f in $files) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), "extension/$f") | Out-Null
    }
} finally {
    $zip.Dispose()
}
Write-Output "built $out"

if ($Install) { & code --install-extension $out --force }
