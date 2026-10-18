param(
  [string]$SdkDirectory = (Join-Path $PSScriptRoot '..\sdk'),
  [string]$AssetsDirectory = (Join-Path $PSScriptRoot '..\web'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build'),
  [string]$VersionName = '1.0.0',
  [int]$VersionCode = 4,
  [string]$ApplicationId = 'local.mixtunes.mobile',
  [string]$ApplicationLabel = 'MixTunes',
  [switch]$RequireExistingKey
)
$ErrorActionPreference = 'Stop'
if ($ApplicationId -notmatch '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$') { throw 'Invalid Android application id.' }
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
$sourceFiles = Get-ChildItem -LiteralPath (Join-Path $nativeRoot 'src') -Filter '*.java' -Recurse -File
$sourceArguments = Join-Path $buildRoot 'sources.txt'
$javaArguments = @($sourceFiles.FullName | ForEach-Object { '"' + $_.Replace('\', '/') + '"' })
[IO.File]::WriteAllLines($sourceArguments, $javaArguments, [Text.UTF8Encoding]::new($false))
Run-Tool (Join-Path $jdkRoot 'bin\javac.exe') @('--release', '8', '-encoding', 'UTF-8', '-classpath', $androidJar, '-d', (Join-Path $buildRoot 'classes'), ('@' + $sourceArguments))
Run-Tool (Join-Path $jdkRoot 'bin\jar.exe') @(('-J-Djava.io.tmpdir=' + (Join-Path $buildRoot 'tmp')), 'cf', (Join-Path $buildRoot 'classes.jar'), '-C', (Join-Path $buildRoot 'classes'), '.')
Run-Tool (Join-Path $toolsRoot 'd8.bat') @('--min-api', '26', '--lib', $androidJar, '--output', (Join-Path $buildRoot 'dex'), (Join-Path $buildRoot 'classes.jar'))
$baseApk = Join-Path $buildRoot 'base.apk'
$manifest = [xml](Get-Content -LiteralPath (Join-Path $nativeRoot 'AndroidManifest.xml') -Raw)
$sourcePackage = $manifest.manifest.package
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$manifest.manifest.SetAttribute('package', $ApplicationId)
$manifest.manifest.application.SetAttribute('label', $androidNamespace, $ApplicationLabel) | Out-Null
# Keep Java component names stable when building a separately installable review app.
foreach ($component in $manifest.SelectNodes('/manifest/application/activity | /manifest/application/service')) {
  $componentName = $component.GetAttribute('name', $androidNamespace)
  if ($componentName.StartsWith('.')) { $component.SetAttribute('name', $androidNamespace, ($sourcePackage + $componentName)) | Out-Null }
}
$resourceArchive = Join-Path $buildRoot 'resources.zip'
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('compile', '--dir', (Join-Path $nativeRoot 'res'), '-o', $resourceArchive)
$manifestPath = Join-Path $buildRoot 'AndroidManifest.xml'
$manifest.Save($manifestPath)
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('link', '-I', $androidJar, $resourceArchive, '--manifest', $manifestPath, '-A', $assetsRoot, '--min-sdk-version', '26', '--target-sdk-version', '35', '--replace-version', '--version-code', [string]$VersionCode, '--version-name', $VersionName, '-o', $baseApk)
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
