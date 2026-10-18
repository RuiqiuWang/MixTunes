param(
  [string]$SdkDirectory = (Join-Path $PSScriptRoot '..\sdk'),
  [string]$AssetsDirectory = (Join-Path $PSScriptRoot '..\web'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build'),
  [string]$VersionName = '1.0.0',
  [int]$VersionCode = 4,
  # Optional: build a second installable copy that coexists with the normal app
  # by using a different application id and launcher name.
  [string]$ApplicationId = '',
  [string]$ApplicationLabel = '',
  [switch]$RequireExistingKey
)
$ErrorActionPreference = 'Stop'
$nativeRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$sdkRoot = [IO.Path]::GetFullPath($SdkDirectory)
$assetsRoot = [IO.Path]::GetFullPath($AssetsDirectory)
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$jdkRoot = $env:JAVA_HOME
if (-not $jdkRoot) { throw 'JAVA_HOME must point to JDK 17 or newer.' }
$androidJar = Join-Path $sdkRoot 'platforms\android-35\android.jar'
$toolsRoot = Join-Path $sdkRoot 'build-tools\35.0.0'
foreach ($tool in @($androidJar, (Join-Path $toolsRoot 'aapt2.exe'), (Join-Path $toolsRoot 'd8.bat'), (Join-Path $toolsRoot 'zipalign.exe'), (Join-Path $toolsRoot 'apksigner.bat'), (Join-Path $jdkRoot 'bin\javac.exe'))) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing build dependency: $tool" }
}
if (-not (Test-Path -LiteralPath (Join-Path $assetsRoot 'index.html') -PathType Leaf)) { throw 'Packaged mobile assets/index.html is required.' }
$buildRoot = [IO.Path]::GetFullPath((Join-Path $nativeRoot 'build-work'))
if (-not $buildRoot.StartsWith($nativeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe build workspace.' }
if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
New-Item -ItemType Directory -Path $buildRoot, $outputRoot, (Join-Path $buildRoot 'classes'), (Join-Path $buildRoot 'dex'), (Join-Path $buildRoot 'tmp') -Force | Out-Null
function Run-Tool([string]$Executable, [string[]]$ToolArguments) {
  & $Executable @ToolArguments
  if ($LASTEXITCODE -ne 0) { throw "Build command failed ($LASTEXITCODE): $Executable" }
}
# A second installable copy needs its own application id; the Java package stays
# untouched, so relative component names are expanded to keep pointing at it.
$manifestPath = Join-Path $nativeRoot 'AndroidManifest.xml'
if ($ApplicationId -or $ApplicationLabel) {
  $manifestText = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8
  $packageMatch = [regex]::Match($manifestText, 'package="([^"]+)"')
  if (-not $packageMatch.Success) { throw 'AndroidManifest.xml is missing a package name.' }
  $sourcePackage = $packageMatch.Groups[1].Value
  if ($ApplicationId) {
    if ($ApplicationId -notmatch '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$') { throw 'ApplicationId must be a dotted package name such as local.mixtunes.mobile.background.' }
    $manifestText = $manifestText.Replace(('package="' + $sourcePackage + '"'), ('package="' + $ApplicationId + '"'))
    if ($ApplicationId -ne $sourcePackage) {
      $manifestText = $manifestText -replace 'android:name="\.([A-Za-z_][A-Za-z0-9_]*)"', ('android:name="' + $sourcePackage + '.$1"')
    }
  }
  if ($ApplicationLabel) {
    $escaped = [System.Security.SecurityElement]::Escape($ApplicationLabel)
    $manifestText = $manifestText -replace '(<application\b[^>]*\bandroid:label=")[^"]*(")', ('${1}' + $escaped + '${2}')
  }
  $manifestPath = Join-Path $buildRoot 'AndroidManifest.xml'
  [IO.File]::WriteAllText($manifestPath, $manifestText, [Text.UTF8Encoding]::new($false))
}
$sourceFiles = Get-ChildItem -LiteralPath (Join-Path $nativeRoot 'src') -Filter '*.java' -Recurse -File
$sourceArguments = Join-Path $buildRoot 'sources.txt'
$javaArguments = @($sourceFiles.FullName | ForEach-Object { '"' + $_.Replace('\', '/') + '"' })
[IO.File]::WriteAllLines($sourceArguments, $javaArguments, [Text.UTF8Encoding]::new($false))
Run-Tool (Join-Path $jdkRoot 'bin\javac.exe') @('--release', '8', '-encoding', 'UTF-8', '-classpath', $androidJar, '-d', (Join-Path $buildRoot 'classes'), ('@' + $sourceArguments))
Run-Tool (Join-Path $jdkRoot 'bin\jar.exe') @(('-J-Djava.io.tmpdir=' + (Join-Path $buildRoot 'tmp')), 'cf', (Join-Path $buildRoot 'classes.jar'), '-C', (Join-Path $buildRoot 'classes'), '.')
Run-Tool (Join-Path $toolsRoot 'd8.bat') @('--min-api', '26', '--lib', $androidJar, '--output', (Join-Path $buildRoot 'dex'), (Join-Path $buildRoot 'classes.jar'))
$baseApk = Join-Path $buildRoot 'base.apk'
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('link', '-I', $androidJar, '--manifest', $manifestPath, '-A', $assetsRoot, '--min-sdk-version', '26', '--target-sdk-version', '35', '--replace-version', '--version-code', [string]$VersionCode, '--version-name', $VersionName, '-o', $baseApk)
Run-Tool (Join-Path $jdkRoot 'bin\jar.exe') @(('-J-Djava.io.tmpdir=' + (Join-Path $buildRoot 'tmp')), 'uf', $baseApk, '-C', (Join-Path $buildRoot 'dex'), 'classes.dex')
$alignedApk = Join-Path $buildRoot 'aligned.apk'
Run-Tool (Join-Path $toolsRoot 'zipalign.exe') @('-p', '-f', '4', $baseApk, $alignedApk)
$keyRoot = [IO.Path]::GetFullPath((Join-Path $nativeRoot '..\signing'))
New-Item -ItemType Directory -Path $keyRoot -Force | Out-Null
$keystore = Join-Path $keyRoot 'mixtunes-debug.p12'
if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
  if ($RequireExistingKey) { throw 'The release signing key is missing. Refusing to create a replacement.' }
  Run-Tool (Join-Path $jdkRoot 'bin\keytool.exe') @('-genkeypair', '-keystore', $keystore, '-storetype', 'PKCS12', '-storepass', 'android', '-keypass', 'android', '-alias', 'mixtunes-debug', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=MixTunes Local Debug,O=Local Development,C=CN')
}
$apk = Join-Path $outputRoot "MixTunes-android-$VersionName-debug.apk"
Run-Tool (Join-Path $toolsRoot 'apksigner.bat') @('sign', '--ks', $keystore, '--ks-key-alias', 'mixtunes-debug', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', $apk, $alignedApk)
Run-Tool (Join-Path $toolsRoot 'zipalign.exe') @('-c', '-v', '4', $apk)
Run-Tool (Join-Path $toolsRoot 'apksigner.bat') @('verify', '--verbose', '--print-certs', $apk)
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('dump', 'badging', $apk)
Get-FileHash -LiteralPath $apk -Algorithm SHA256
Write-Output "APK: $apk"
