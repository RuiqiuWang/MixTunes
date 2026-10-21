$ErrorActionPreference = 'Stop'
$classes = Join-Path $PSScriptRoot 'mobile-login-test-classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
$sources = @((Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'test\login-stubs') -Recurse -Filter '*.java' -File).FullName)
$sources += Join-Path $PSScriptRoot 'src\local\mixtunes\mobile\MobileLogin.java'
$sources += Join-Path $PSScriptRoot 'test\MobileLoginTest.java'
& (Join-Path $env:JAVA_HOME 'bin\javac.exe') --release 8 -encoding UTF8 -d $classes @sources
if ($LASTEXITCODE -ne 0) { throw 'Mobile login routing test compilation failed' }
& (Join-Path $env:JAVA_HOME 'bin\java.exe') -classpath $classes local.mixtunes.mobile.MobileLoginTest
if ($LASTEXITCODE -ne 0) { throw 'Mobile login routing test failed' }
