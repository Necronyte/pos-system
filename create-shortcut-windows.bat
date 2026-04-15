@echo off
:: Coffee Shop POS — Windows Masaüstü Kısayolu Oluşturucu
:: Bu dosyayı uygulamayı kurduktan sonra çalıştırın.

echo Coffee Shop POS masaüstü kısayolu oluşturuluyor...

:: Kurulum sonrası exe yolunu bul
set EXE_PATH=%LOCALAPPDATA%\Programs\coffee-shop-pos\Coffee Shop POS.exe

:: Eğer o yolda yoksa, mevcut dizinde ara
if not exist "%EXE_PATH%" (
  set EXE_PATH=%~dp0Coffee Shop POS.exe
)

:: PowerShell ile .lnk kısayolu oluştur
powershell -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $sc = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Coffee Shop POS.lnk'); ^
   $sc.TargetPath = '%EXE_PATH%'; ^
   $sc.Description = 'Coffee Shop POS Kasiyer Terminali'; ^
   $sc.WorkingDirectory = [System.IO.Path]::GetDirectoryName('%EXE_PATH%'); ^
   $sc.IconLocation = '%EXE_PATH%,0'; ^
   $sc.Save()"

if %errorlevel% == 0 (
  echo Kısayol masaüstüne oluşturuldu!
) else (
  echo HATA: Kısayol oluşturulamadı. Lütfen uygulamanın kurulu olduğundan emin olun.
)
pause
