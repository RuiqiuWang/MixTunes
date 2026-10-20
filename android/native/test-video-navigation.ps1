$ErrorActionPreference = 'Stop'
$classes = Join-Path $PSScriptRoot 'video-navigation-test-classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
& (Join-Path $env:JAVA_HOME 'bin\javac.exe') --release 8 -encoding UTF-8 -d $classes (Join-Path $PSScriptRoot 'src\local\mixtunes\mobile\BilibiliVideoTarget.java') (Join-Path $PSScriptRoot 'test\BilibiliVideoTargetTest.java')
if ($LASTEXITCODE -ne 0) { throw 'Video navigation test compilation failed' }
& (Join-Path $env:JAVA_HOME 'bin\java.exe') -classpath $classes local.mixtunes.mobile.BilibiliVideoTargetTest
if ($LASTEXITCODE -ne 0) { throw 'Video navigation test failed' }
