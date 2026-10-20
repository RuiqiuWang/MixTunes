$ErrorActionPreference = 'Stop'
$classes = Join-Path $PSScriptRoot 'sleep-timer-test-classes'
New-Item -ItemType Directory -Path $classes -Force | Out-Null
& (Join-Path $env:JAVA_HOME 'bin\javac.exe') --release 8 -encoding UTF-8 -d $classes (Join-Path $PSScriptRoot 'src\local\mixtunes\mobile\SleepTimer.java') (Join-Path $PSScriptRoot 'src\local\mixtunes\mobile\SleepTimerPolicy.java') (Join-Path $PSScriptRoot 'test\SleepTimerTest.java')
if ($LASTEXITCODE -ne 0) { throw 'SleepTimer compilation failed' }
& (Join-Path $env:JAVA_HOME 'bin\java.exe') -classpath $classes local.mixtunes.mobile.SleepTimerTest
if ($LASTEXITCODE -ne 0) { throw 'SleepTimer test failed' }
