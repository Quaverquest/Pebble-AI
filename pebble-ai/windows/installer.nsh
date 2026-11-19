!macro customInstall
  ; Create organized local directories for models, images, and logs
  CreateDirectory "$LOCALAPPDATA\PebbleAI"
  CreateDirectory "$LOCALAPPDATA\PebbleAI\models"
  CreateDirectory "$LOCALAPPDATA\PebbleAI\images"
  CreateDirectory "$LOCALAPPDATA\PebbleAI\workspace"
  CreateDirectory "$LOCALAPPDATA\PebbleAI\logs"

  ; Bootstrap Python DirectML / CPU environment in background if Python is present
  ExecWait 'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\windows\setup-victus-rx6500m.ps1" -Quiet'
!macroend

!macro customUnInstall
  ; Preserve user models and conversations by default; remove only runtime cache
  RMDir /r "$LOCALAPPDATA\PebbleAI\cache"
!macroend
