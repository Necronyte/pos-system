@echo off
:: ============================================================
::  Coffee Shop POS — Kurulum Scripti
::  better-sqlite3 v11 + Electron 31 uyumlu
:: ============================================================
setlocal
cd /d "%~dp0"

echo.
echo  Coffee Shop POS — Kurulum
echo  ===========================
echo.

:: Eski node_modules temizle
if exist "node_modules" (
  echo  Eski node_modules temizleniyor...
  rmdir /s /q node_modules 2>nul
)

:: npm install
echo  Paketler yukleniyor...
call npm install --ignore-scripts
if %errorlevel% neq 0 ( echo  HATA: npm install! & pause & exit /b 1 )

:: electron-rebuild — better-sqlite3'ü Electron 31 için derle
echo.
echo  better-sqlite3 Electron icin derleniyor (bu biraz surebilir)...
call npx electron-rebuild -f -w better-sqlite3
if %errorlevel% neq 0 (
  echo.
  echo  HATA: Derleme basarisiz!
  echo  Visual Studio 2022 Build Tools kurulu olmali.
  echo  https://visualstudio.microsoft.com/visual-cpp-build-tools/
  pause & exit /b 1
)

echo.
echo  =============================================
echo   KURULUM TAMAMLANDI!
echo   Baslatmak icin: npm start
echo  =============================================
echo.
pause
