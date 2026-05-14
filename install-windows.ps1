param(
  [string]$ExtensionId = "",
  [string]$Chrome = "Google",
  [switch]$UseManifestKey
)

$ErrorActionPreference = "Stop"
$NativeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $NativeDir
$ManifestPath = Join-Path $RepoRoot "manifest.json"
$HostPath = Join-Path $NativeDir "tabctrl-bridge.cmd"
$NativeManifestPath = Join-Path $NativeDir "com.tabctrl.bridge.installed.json"
$StoreExtensionId = "bniefocpdldneagigjlhbllgdjohmeie"

function Get-ChromeExtensionIdFromKey([string]$Key) {
  $bytes = [Convert]::FromBase64String($Key)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash($bytes)
  $chars = New-Object System.Collections.Generic.List[char]
  for ($i = 0; $i -lt 16; $i++) {
    $b = $hash[$i]
    $chars.Add([char](97 + (($b -shr 4) -band 15)))
    $chars.Add([char](97 + ($b -band 15)))
  }
  -join $chars
}

if (-not $ExtensionId -and $UseManifestKey) {
  $manifest = Get-Content -Raw -Encoding UTF8 -Path $ManifestPath | ConvertFrom-Json
  if ($manifest.key) {
    $ExtensionId = Get-ChromeExtensionIdFromKey $manifest.key
  }
}

if (-not $ExtensionId) {
  $ExtensionId = $StoreExtensionId
}

if (-not $ExtensionId) {
  throw "ExtensionId is required. Pass -ExtensionId <id> or keep a manifest.json key."
}

$nativeManifest = [ordered]@{
  name = "com.tabctrl.bridge"
  description = "TabCtrl native messaging bridge"
  path = $HostPath
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$json = $nativeManifest | ConvertTo-Json -Depth 5
Set-Content -Encoding UTF8 -Path $NativeManifestPath -Value $json

$vendor = if ($Chrome -match "Edge") { "Microsoft\Edge" } else { "Google\Chrome" }
$keyPath = "HKCU:\Software\$vendor\NativeMessagingHosts\com.tabctrl.bridge"
New-Item -Force -Path $keyPath | Out-Null
Set-ItemProperty -Path $keyPath -Name "(default)" -Value $NativeManifestPath

Write-Host "Registered com.tabctrl.bridge for extension $ExtensionId"
Write-Host "Manifest: $NativeManifestPath"
