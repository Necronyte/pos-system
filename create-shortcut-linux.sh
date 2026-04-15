#!/usr/bin/env bash
# Coffee Shop POS — Linux Masaüstü Kısayolu Oluşturucu
# Kullanım: bash create-shortcut-linux.sh

set -e

DESKTOP_DIR="$HOME/Desktop"
APPLICATIONS_DIR="$HOME/.local/share/applications"
APPIMAGE_PATH=""

# AppImage dosyasını bul
for candidate in \
  "$HOME/Applications/Coffee Shop POS"*.AppImage \
  "$(dirname "$0")/dist/Coffee Shop POS"*.AppImage \
  "$(dirname "$0")/Coffee Shop POS"*.AppImage; do
  if [ -f "$candidate" ]; then
    APPIMAGE_PATH="$candidate"
    break
  fi
done

if [ -z "$APPIMAGE_PATH" ]; then
  echo "HATA: Coffee Shop POS.AppImage bulunamadı."
  echo "dist/ klasörüne bakın ve bu scripti tekrar çalıştırın."
  exit 1
fi

ICON_PATH="$(dirname "$0")/assets/icon.png"

create_desktop_entry() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  cat > "$target_dir/coffee-shop-pos.desktop" << DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=Coffee Shop POS
GenericName=POS Terminal
Comment=Kahve Dükkanı Kasiyer Terminali
Exec="${APPIMAGE_PATH}"
Icon=${ICON_PATH}
Terminal=false
Categories=Office;Finance;
Keywords=pos;kasa;kahve;sipariş;
StartupWMClass=coffee-shop-pos
DESKTOP
  chmod +x "$target_dir/coffee-shop-pos.desktop"
  echo "  ✓ $target_dir/coffee-shop-pos.desktop oluşturuldu"
}

echo "Coffee Shop POS kısayolları oluşturuluyor..."
echo "AppImage: $APPIMAGE_PATH"
echo ""

# Masaüstü kısayolu
if [ -d "$DESKTOP_DIR" ]; then
  create_desktop_entry "$DESKTOP_DIR"
fi

# Uygulama menüsü (uygulama başlatıcıda görünür)
create_desktop_entry "$APPLICATIONS_DIR"

# Menüyü güncelle
if command -v update-desktop-database &> /dev/null; then
  update-desktop-database "$APPLICATIONS_DIR" 2>/dev/null || true
fi

echo ""
echo "Tamamlandı! Masaüstünüzde 'Coffee Shop POS' kısayolunu görebilirsiniz."
