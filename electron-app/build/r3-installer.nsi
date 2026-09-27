; ============================================================================
; MEMENTO Setup — R3 task #9
; A real Windows installer wizard for MEMENTO, built from the user-provided
; MEMENTO Setup HTML design (dark #050806, #22c55e accents, the circular
; MEMENTO eye, "from EPODONIOS to A Who").
;
; Per-user install (no UAC): $LOCALAPPDATA\Programs\MEMENTO
; Pages: Welcome -> License -> Directory -> Install -> Finish (run app)
; Shortcuts: Desktop + Start Menu; a real uninstaller with the same branding.
; Compiled with native Linux makensis (cross-compile) — no wine involved.
; ============================================================================

Unicode true
ManifestDPIAware true

; electron-builder's NSIS distribution (MUI2 + the unicode plugin set)
!addincludedir "/tmp/wine-root/usr/share/nsis/Include"
!addplugindir "/tmp/wine-root/usr/share/nsis/Plugins/x86-unicode"

!define PRODUCT_NAME "MEMENTO"
!define PRODUCT_VERSION "3.1.5"
!define PRODUCT_PUBLISHER "EPODONIOS"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MEMENTO"
!define INSTALL_ROOT "$LOCALAPPDATA\Programs\MEMENTO"

!include "MUI2.nsh"

; --- branding (generated from the provided design) ---
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "/home/z/my-project/memento-src/electron-app/build/installerHeader.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "/home/z/my-project/memento-src/electron-app/build/installerSidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "/home/z/my-project/memento-src/electron-app/build/installerSidebar.bmp"
!define MUI_ABORTWARNING
!define MUI_ICON "/home/z/my-project/memento-src/electron-app/build/icon.ico"
!define MUI_UNICON "/home/z/my-project/memento-src/electron-app/build/icon.ico"

!define MUI_LICENSEPAGE_RADIOBUTTONS
!define MUI_FINISHPAGE_RUN "$INSTDIR\MEMENTO.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Run MEMENTO now"

; MEMENTO dark-green page colors (design tokens: bg #050806, accent #22c55e)
InstallColors 060805 22c55e
InstallDirRegKey HKCU "${PRODUCT_UNINST_KEY}" "InstallLocation"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "/home/z/my-project/memento-src/electron-app/release/MementoSetup-${PRODUCT_VERSION}.exe"
InstallDir "${INSTALL_ROOT}"
ShowInstDetails show
ShowUnInstDetails show
RequestExecutionLevel user
SetCompressor /SOLID lzma

; the electron-builder NSIS package ships MUI2 + plugins; include dirs are
; added via /X!addincludedir and /X!addplugindir by the invoking script.

; ---------------------------------------------------------------------------
; Pages
; ---------------------------------------------------------------------------
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "/home/z/my-project/memento-src/electron-app/build/license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Sections
; ---------------------------------------------------------------------------
Section "MEMENTO (required)" SEC_MAIN
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "/home/z/my-project/memento-src/electron-app/release/win-unpacked/*"

  ; shortcut set
  CreateDirectory "$SMPROGRAMS\MEMENTO"
  CreateShortCut "$SMPROGRAMS\MEMENTO\MEMENTO.lnk" "$INSTDIR\MEMENTO.exe"
  CreateShortCut "$DESKTOP\MEMENTO.lnk" "$INSTDIR\MEMENTO.exe"

  ; uninstaller
  WriteUninstaller "$INSTDIR\Uninstall MEMENTO.exe"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "MEMENTO — from EPODONIOS to A Who"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\Uninstall MEMENTO.exe"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\MEMENTO.exe"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\MEMENTO" "InstallLocation" "$INSTDIR"
SectionEnd

Section -Post
  ; keep the window on top of nothing — placeholder section for future extras
SectionEnd

; ---------------------------------------------------------------------------
; Uninstaller
; ---------------------------------------------------------------------------
Function un.onInit
  ; never run from inside the install dir with the app running — warn only
FunctionEnd

Section Uninstall
  ; kill the app first — a running MEMENTO locks its files
  ExecWait 'taskkill /F /IM MEMENTO.exe /T'
  ExecWait 'taskkill /F /IM xray.exe /T'
  ExecWait 'taskkill /F /IM sing-box.exe /T'
  ExecWait 'taskkill /F /IM aether.exe /T'
  Sleep 600

  Delete "$DESKTOP\MEMENTO.lnk"
  Delete "$SMPROGRAMS\MEMENTO\MEMENTO.lnk"
  RMDir "$SMPROGRAMS\MEMENTO"

  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\MEMENTO.exe"
  Delete "$INSTDIR\Uninstall MEMENTO.exe"
  ; user data (%APPDATA%\com.epodonios.memento) is deliberately KEPT
  ; (deleteAppDataOnUninstall: false — the user's configs survive)

  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"
  SetAutoClose true
SectionEnd
