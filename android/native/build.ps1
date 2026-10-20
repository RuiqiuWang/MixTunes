param(
  [string]$SdkDirectory = (Join-Path $PSScriptRoot '..\sdk'),
  [string]$AssetsDirectory = (Join-Path $PSScriptRoot '..\web'),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\build'),
  [string]$VersionName = '1.0.0',
  [int]$VersionCode = 4,
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
# The SDK's native tools hand narrow path arguments to the file APIs, which use the
# ANSI code page. An absolute path containing non-ASCII characters (for example a
# local user name in the checkout path) then fails with "failed to open directory". Passing
# paths relative to the project directory avoids the conversion, because Windows
# resolves relative names against the Unicode working directory.
function Get-RelativePath([string]$Base, [string]$Target) {
  $baseUri = [Uri](([IO.Path]::GetFullPath($Base)).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar)
  $targetUri = [Uri][IO.Path]::GetFullPath($Target)
  return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString())
}
$sourceFiles = Get-ChildItem -LiteralPath (Join-Path $nativeRoot 'src') -Filter '*.java' -Recurse -File
$sourceArguments = Join-Path $buildRoot 'sources.txt'
$javaArguments = @($sourceFiles.FullName | ForEach-Object { '"' + $_.Replace('\', '/') + '"' })
[IO.File]::WriteAllLines($sourceArguments, $javaArguments, [Text.UTF8Encoding]::new($false))
# -J-Dfile.encoding=UTF-8 makes javac decode @argfiles as UTF-8. Without it JDK 17
# reads them with the platform code page and rejects the non-ASCII source paths.
Run-Tool (Join-Path $jdkRoot 'bin\javac.exe') @('-J-Dfile.encoding=UTF-8', '--release', '8', '-encoding', 'UTF-8', '-classpath', $androidJar, '-d', (Join-Path $buildRoot 'classes'), ('@' + $sourceArguments))
Run-Tool (Join-Path $jdkRoot 'bin\jar.exe') @(('-J-Djava.io.tmpdir=' + (Join-Path $buildRoot 'tmp')), 'cf', (Join-Path $buildRoot 'classes.jar'), '-C', (Join-Path $buildRoot 'classes'), '.')
Run-Tool (Join-Path $toolsRoot 'd8.bat') @('--min-api', '26', '--lib', $androidJar, '--output', (Join-Path $buildRoot 'dex'), (Join-Path $buildRoot 'classes.jar'))
$baseApk = Join-Path $buildRoot 'base.apk'
$compiledResources = Join-Path $buildRoot 'resources.zip'
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('compile', '--dir', (Join-Path $nativeRoot 'res'), '-o', $compiledResources)
Run-Tool (Join-Path $toolsRoot 'aapt2.exe') @('link', '-I', $androidJar, '--manifest', (Join-Path $nativeRoot 'AndroidManifest.xml'), '-A', $assetsRoot, '-R', $compiledResources, '--min-sdk-version', '26', '--target-sdk-version', '35', '--replace-version', '--version-code', [string]$VersionCode, '--version-name', $VersionName, '-o', $baseApk)
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
