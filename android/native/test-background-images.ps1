$ErrorActionPreference = 'Stop'
$classes = Join-Path $PSScriptRoot 'background-test-classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
& (Join-Path $env:JAVA_HOME 'bin\javac.exe') --release 8 -encoding UTF-8 -d $classes (Join-Path $PSScriptRoot 'src\local\mixtunes\mobile\BackgroundImages.java') (Join-Path $PSScriptRoot 'test\BackgroundImagesTest.java')
if ($LASTEXITCODE -ne 0) { throw 'BackgroundImages compilation failed' }
& (Join-Path $env:JAVA_HOME 'bin\java.exe') -classpath $classes local.mixtunes.mobile.BackgroundImagesTest
if ($LASTEXITCODE -ne 0) { throw 'BackgroundImages test failed' }
