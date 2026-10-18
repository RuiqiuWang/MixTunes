param(
  [string]$ApkPath = (Join-Path $PSScriptRoot '..\build\MixTunes-android-1.0.0-debug.apk'),
  [string]$AssetsDirectory = (Join-Path $PSScriptRoot '..\web'),
  [string]$VerificationPath = (Join-Path $PSScriptRoot '..\build-verification.json'),
  [string]$DeliverablePath = '',
  [string]$SdkDirectory = (Join-Path $PSScriptRoot '..\sdk'),
  [string]$ExpectedVersion = '1.0.0',
  [int]$ExpectedVersionCode = 4,
  [string]$ExpectedPackageName = 'local.mixtunes.mobile',
  [string]$ExpectedCertificateSha256 = '',
  [string]$RuntimeReportPath = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apk = [IO.Path]::GetFullPath($ApkPath)
$assets = [IO.Path]::GetFullPath($AssetsDirectory)
$tools = [IO.Path]::GetFullPath((Join-Path $SdkDirectory 'build-tools\35.0.0'))
function Verify-Tool([string]$Executable, [string[]]$Arguments) {
  $result = & $Executable @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Verification failed: $Executable`n$($result -join "`n")" }
  return ($result -join "`n")
}
$alignment = Verify-Tool (Join-Path $tools 'zipalign.exe') @('-c', '4', $apk)
$signature = Verify-Tool (Join-Path $tools 'apksigner.bat') @('verify', '--verbose', '--print-certs', $apk)
if ($signature -notmatch 'Verified using v2 scheme .*: true' -or $signature -notmatch 'Verified using v3 scheme .*: true') { throw 'Required APK signature schemes absent' }
$badging = Verify-Tool (Join-Path $tools 'aapt2.exe') @('dump', 'badging', $apk)
$packagePattern = "name='" + [regex]::Escape($ExpectedPackageName) + "' versionCode='$ExpectedVersionCode' versionName='" + [regex]::Escape($ExpectedVersion) + "'"
if ($badging -notmatch $packagePattern -or $badging -notmatch "minSdkVersion:'26'" -or $badging -notmatch "targetSdkVersion:'35'") { throw 'Unexpected Android package or SDK configuration' }
$coreVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$testedRuntime = $null
if ($RuntimeReportPath) {
  $testedRuntime = Get-Content -LiteralPath $RuntimeReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $testedRuntime.passed -or $testedRuntime.coreVersion -ne $coreVersion -or $testedRuntime.version -ne $ExpectedVersion) { throw 'Runtime regression report differs from the current version.' }
}
$webFiles = @()
$zip = [IO.Compression.ZipFile]::OpenRead($apk)
try {
  if ($zip.Entries.FullName -match '(?i)(^|/)signing/|\.(p12|jks|keystore)$') { throw 'Private signing material in APK' }
  foreach ($name in @('index.html', 'appearance.js', 'runtime.js', 'styles.css', 'ui.js')) {
    $entry = $zip.GetEntry('assets/' + $name)
    if ($null -eq $entry) { throw "Missing packaged asset: $name" }
    $stream = $entry.Open()
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $packagedHash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    $sourcePath = Join-Path $assets $name
    $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($packagedHash -ne $sourceHash -or $entry.Length -ne (Get-Item -LiteralPath $sourcePath).Length) { throw "Packaged asset differs from final source: $name" }
    if ($testedRuntime -and $name -eq 'runtime.js' -and $sourceHash -ne $testedRuntime.bundleSha256) { throw 'runtime.js differs from the tested final bundle' }
    $webFiles += [ordered]@{ name = $name; bytes = $entry.Length; sourceSha256 = $sourceHash; packagedSha256 = $packagedHash; matches = $true }
  }
} finally { $zip.Dispose() }
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$target = $null
if ($DeliverablePath) {
  $target = [IO.Path]::GetFullPath($DeliverablePath)
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
  if (-not [string]::Equals($apk, $target, [StringComparison]::OrdinalIgnoreCase)) { Copy-Item -LiteralPath $apk -Destination $target -Force }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Delivered APK copy differs' }
}
$certificate = [regex]::Match($signature, 'certificate SHA-256 digest: ([0-9a-f]+)').Groups[1].Value
if ($ExpectedCertificateSha256 -and $certificate -ne $ExpectedCertificateSha256.ToLowerInvariant()) { throw 'Signing certificate changed; installed phone upgrade would not be compatible.' }
$report = [ordered]@{
  verifiedAtUtc = [DateTime]::UtcNow.ToString('o')
  packageName = $ExpectedPackageName
  versionName = $ExpectedVersion
  versionCode = $ExpectedVersionCode
  sharedDesktopCoreVersion = $coreVersion
  minSdk = 26
  targetSdk = 35
  apkPath = $apk
  deliverablePath = $target
  bytes = (Get-Item -LiteralPath $apk).Length
  sha256 = $hash
  zipalignPassed = $true
  apkSignatureV2 = $true
  apkSignatureV3 = $true
  signingCertificateSha256 = $certificate
  privateSigningMaterialPackaged = $false
  webAssets = $webFiles
  actualAndroidDeviceUsed = $false
  adbDeviceCount = 0
  runtimeRegressionVerified = [bool]$testedRuntime
  limitations = @('No physical Android device or emulator used. Actual platform login, MediaPlayer decoding, Bilibili WebView playback and background queue transitions remain unverified.')
  signatureVerification = $signature
  manifestBadging = $badging
}
$reportPath = [IO.Path]::GetFullPath($VerificationPath)
[IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
[pscustomobject]$report | Select-Object packageName, versionName, bytes, sha256, deliverablePath, actualAndroidDeviceUsed | ConvertTo-Json
Write-Output "Verification: $reportPath"
