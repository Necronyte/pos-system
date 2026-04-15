@echo off
:: ============================================================
::  Coffee Shop POS — Windows Build Script (v4)
:: ============================================================
setlocal
set "DIR=%~dp0"
cd /d "%DIR%"

echo.
echo  Coffee Shop POS - Windows Build
echo  ==================================
echo.

:: 1. node_modules kontrolü
if not exist "node_modules" (
    echo  node_modules bulunamadi. npm install calistiriliyor...
    call npm install
    if %errorlevel% neq 0 ( echo  HATA: npm install basarisiz! & pause & exit /b 1 )
)

:: 2. Patch uygulandı mı kontrol et (iki dosyayı da kontrol et)
set "BUNDLED=node_modules\app-builder-lib\out\util\bundledTool.js"
set "PATCHED=0"
findstr /q "PATCH: intercept winCodeSign" "%BUNDLED%" 2>nul && set PATCHED=1

if "%PATCHED%"=="0" (
    echo  Yamalar henuz uygulanmamis. fake-wincosesign-cache.ps1 calistiriliyor...
    echo.
    powershell -ExecutionPolicy Bypass -File "%DIR%fake-wincosesign-cache.ps1"
    echo.
)

:: 3. Kod imzalama env değişkenlerini kapat
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=
set WIN_CSC_KEY_PASSWORD=
set CSC_LINK=
set CSC_KEY_PASSWORD=

:: 4. Build
echo  Portable .exe olusturuluyor...
echo.
call npx electron-builder --win portable

if %errorlevel% == 0 (
    echo.
    echo  ================================================
    echo   BASARILI!
    echo   dist\Coffee Shop POS-Portable-1.0.0.exe
    echo  ================================================
    echo.
    echo  Masaustu kisayolu icin build-shortcut.bat calistirin.
    echo.
) else (
    echo.
    echo  ================================================
    echo   BUILD BASARISIZ
    echo  ================================================
    echo.
    echo  Son cozum: Windows Developer Mode'u acin.
    echo.
    echo  Ayarlar - Gizlilik ve Guvenlik - Gelistiriciler icin
    echo  Gelistirici Modu: ACIK
    echo.
    echo  Sonra bu dosyayi tekrar calistirin.
    echo.
)
pause
