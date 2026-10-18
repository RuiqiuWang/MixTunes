$ErrorActionPreference = 'Stop'
$classes = Join-Path $PSScriptRoot 'qq-login-test-classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
& (Join-Path $env:JAVA_HOME 'bin\javac.exe') --release 8 -encoding UTF-8 -d $classes (Join-Path $PSScriptRoot 'src\local\mixtunes\mobile\QqMobileLogin.java') (Join-Path $PSScriptRoot 'test\QqMobileLoginTest.java')
if ($LASTEXITCODE -ne 0) { throw 'QQ login helper test compilation failed' }
$result = & (Join-Path $env:JAVA_HOME 'bin\java.exe') -classpath $classes local.mixtunes.mobile.QqMobileLoginTest
if ($LASTEXITCODE -ne 0) { throw 'QQ login helper tests failed' }
$urls = [ordered]@{}
foreach ($line in $result) { if ($line -match '^(defaultUrl|desktopScript)=(.*)$') { $urls[$Matches[1]] = $Matches[2] } else { Write-Output $line } }
$probe = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\qq-mobile-login-probe'))
New-Item -ItemType Directory -Path $probe -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $probe 'native-urls.json'), ($urls | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
