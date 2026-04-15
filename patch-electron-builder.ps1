# ============================================================
#  Coffee Shop POS — electron-builder winCodeSign Patch
#
#  Bu script, electron-builder'ın winCodeSign indirme adımını
#  tamamen devre dışı bırakır.
#
#  Nasıl çalıştırılır:
#    Dosyaya SAĞ TIKLAYIN → "PowerShell ile çalıştır"
#    VEYA terminal'de:
#    powershell -ExecutionPolicy Bypass -File patch-electron-builder.ps1
# ============================================================

Write-Host ""
Write-Host "  Coffee Shop POS - electron-builder Yaması" -ForegroundColor Cyan
Write-Host "  ===========================================" -ForegroundColor Cyan
Write-Host ""

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- Hedef dosyaları bul ---
$targets = @(
    "node_modules\app-builder-lib\out\codeSign\windowsCodeSign.js",
    "node_modules\app-builder-lib\out\util\bundledTool.js"
)

$patched = 0

foreach ($rel in $targets) {
    $file = Join-Path $projectDir $rel
    if (-not (Test-Path $file)) {
        Write-Host "  Atlandı (bulunamadı): $rel" -ForegroundColor DarkGray
        continue
    }

    $backup = $file + ".orig"
    if (-not (Test-Path $backup)) {
        Copy-Item $file $backup
        Write-Host "  Yedeklendi: $rel" -ForegroundColor DarkGreen
    }

    $c = Get-Content $file -Raw -Encoding UTF8

    $changed = $false

    # ── windowsCodeSign.js patches ─────────────────────────────

    # Patch A: getSignVendorPath() — the function that triggers the download.
    # Replace the entire function body to return empty string immediately.
    if ($c -match 'async function getSignVendorPath\(\)') {
        # Insert early return right after the opening brace of the function
        $c = $c -replace '(async function getSignVendorPath\(\)\s*\{)', '$1 return ""; /* PATCHED */'
        Write-Host "  [OK] Patch A: getSignVendorPath() erken dönüş eklendi" -ForegroundColor Green
        $changed = $true
    }

    # Patch B: skip signing when cscInfo is null (belt-and-suspenders)
    if ($c -match 'if \(options\.cscInfo == null\)') {
        $c = $c -replace 'if \(options\.cscInfo == null\)', 'if (true /* PATCHED - no signing */)'
        Write-Host "  [OK] Patch B: cscInfo null kontrolü bypass edildi" -ForegroundColor Green
        $changed = $true
    }

    # Patch C: alternative pattern in newer builds
    if ($c -match 'if \(cscInfo == null\)') {
        $c = $c -replace 'if \(cscInfo == null\)', 'if (true /* PATCHED - no signing */)'
        Write-Host "  [OK] Patch C: cscInfo null kontrolü bypass edildi" -ForegroundColor Green
        $changed = $true
    }

    # ── bundledTool.js patches ──────────────────────────────────

    # Patch D: getBinFromGithub for winCodeSign — make it return a fake resolved path
    if ($c -match 'winCodeSign') {
        # Wrap the winCodeSign getBinFromGithub call to short-circuit
        $c = $c -replace '(getBinFromGithub\(["\x27]winCodeSign["\x27][^)]*\))', 'Promise.resolve("") /* PATCHED */'
        Write-Host "  [OK] Patch D: getBinFromGithub(winCodeSign) bypass edildi" -ForegroundColor Green
        $changed = $true
    }

    if ($changed) {
        Set-Content $file $c -Encoding UTF8 -NoNewline
        $patched++
        Write-Host "  Kaydedildi: $rel`n" -ForegroundColor Green
    } else {
        Write-Host "  Değişiklik gerekmedi: $rel`n" -ForegroundColor Yellow
    }
}

if ($patched -gt 0) {
    Write-Host "  Yama tamamlandı! ($patched dosya güncellendi)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Şimdi çalıştırın:" -ForegroundColor White
    Write-Host "    build-windows.bat" -ForegroundColor Yellow
} else {
    Write-Host "  Hiçbir dosya yamalanmadı." -ForegroundColor Yellow
    Write-Host "  electron-builder sürümünüz farklı bir yapıya sahip olabilir." -ForegroundColor Yellow
    Write-Host "  Aşağıdaki manuel yöntemi deneyin (README.md'ye bakın)." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "  Devam etmek için Enter'a basın"
