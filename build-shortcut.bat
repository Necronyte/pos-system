@echo off
:: ============================================
::  Coffee Shop POS — Masaüstü Kısayol Oluşturucu
::  build-windows.bat çalıştırıldıktan sonra kullanın
:: ============================================

echo.
echo  Masaustu kisayolu olusturuluyor...
echo.

:: Portable exe yolunu bul
set EXE_PATH=%~dp0dist\Coffee Shop POS-Portable-1.0.0.exe
set SHORTCUT_NAME=Coffee Shop POS

if not exist "%EXE_PATH%" (
  echo  HATA: %EXE_PATH% bulunamadi.
  echo  Once build-windows.bat dosyasini calistirin.
  pause
  exit /b 1
)

:: PowerShell ile masaüstüne .lnk kısayolu oluştur
powershell -ExecutionPolicy Bypass -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$sc = $ws.CreateShortcut($desktop + '\%SHORTCUT_NAME%.lnk');" ^
  "$sc.TargetPath = '%EXE_PATH:\=\\%';" ^
  "$sc.WorkingDirectory = '%~dp0dist\\';" ^
  "$sc.Description = 'Coffee Shop POS Kasiyer Terminali';" ^
  "$sc.Save();"

if %errorlevel% == 0 (
  echo  Masaustu kisayolu olusturuldu: %SHORTCUT_NAME%.lnk
  echo  Artik masaustunden cift tiklayarak acabilirsiniz!
) else (
  echo  HATA: Kisayol olusturulamadi.
)
echo.
pause
