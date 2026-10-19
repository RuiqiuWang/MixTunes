; ---------------------------------------------------------------------------
; MixTunes - custom NSIS hooks
;
; electron-builder's stock "is the app already running?" check
; (templates/nsis/include/allowOnlyOneInstallerInstance.nsh) tries to close a
; live MixTunes, and if the process survives it drops into an endless
; MB_RETRYCANCEL loop showing $(appCannotBeClosed) - the "unable to close"
; dialog. Retrying never helps, so the install can never finish.
;
; Defining customCheckAppRunning makes electron-builder call this macro
; instead, so a running MixTunes is simply closed and the install continues.
; ---------------------------------------------------------------------------

!macro customCheckAppRunning
  DetailPrint "Closing any running MixTunes instances..."

  ; Ask the app to exit normally first. /T also ends the renderer/GPU/utility
  ; child processes Electron spawns.
  nsExec::Exec `taskkill /T /IM "MixTunes.exe"`
  Pop $0
  Sleep 1500

  ; Force anything that is still alive (window not responding, elevated copy).
  ; The installer binary itself is never named MixTunes.exe, so this can't
  ; kill our own process.
  nsExec::Exec `taskkill /F /T /IM "MixTunes.exe"`
  Pop $0
  Sleep 1200
!macroend
