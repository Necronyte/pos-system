#!/usr/bin/env bash
# Coffee Shop POS — macOS Kısayol / Dock Ekleme Kılavuzu

echo "╔══════════════════════════════════════════╗"
echo "║     Coffee Shop POS — macOS Kurulum      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

DMG_PATH=$(find "$(dirname "$0")/dist" -name "*.dmg" 2>/dev/null | head -1)

if [ -z "$DMG_PATH" ]; then
  echo "HATA: .dmg dosyası dist/ klasöründe bulunamadı."
  echo "Önce 'npm run build:mac' komutunu çalıştırın."
  exit 1
fi

echo "1. DMG dosyası açılıyor: $DMG_PATH"
open "$DMG_PATH"

echo ""
echo "2. Açılan pencerede 'Coffee Shop POS' simgesini"
echo "   'Applications' klasörüne sürükleyin."
echo ""
echo "3. Dock'a eklemek için:"
echo "   - Applications > Coffee Shop POS.app'i açın"
echo "   - Dock'taki simgeye sağ tıklayın"
echo "   - 'Options > Keep in Dock' seçin"
echo ""
echo "4. Masaüstü alias oluşturmak için:"

APP_PATH="/Applications/Coffee Shop POS.app"
DESKTOP="$HOME/Desktop"

if [ -d "$APP_PATH" ]; then
  osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$APP_PATH\" at POSIX file \"$DESKTOP\""
  echo "   ✓ Masaüstü kısayolu oluşturuldu: $DESKTOP/Coffee Shop POS alias"
else
  echo "   (Uygulama Applications klasörüne kurulduktan sonra çalıştırın)"
fi
