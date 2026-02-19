Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $root 'youtube-rapper-toolkit-v1.4.0.zip'

if (Test-Path $zipPath) { Remove-Item $zipPath }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')

$files = @(
  'manifest.json',
  'content.js',
  'background.js',
  'styles.css',
  'icons/icon-48.png',
  'icons/icon-96.png'
)

foreach ($f in $files) {
  $fullPath = Join-Path $root ($f -replace '/', '\')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $f) | Out-Null
  Write-Host "  Added: $f"
}

$zip.Dispose()
Write-Host "Created: $zipPath"
