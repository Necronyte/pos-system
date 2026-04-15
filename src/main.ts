/* =============================================
   COFFEE SHOP POS — main.ts (Electron)
   ============================================= */

'use strict';

import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs   from 'fs';
import * as db   from './database';

const isDev: boolean = process.env.NODE_ENV === 'development';
app.setName('Coffee Shop POS');

let mainWindow:   BrowserWindow | null = null;
let currentUser:  string               = 'system';

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 960, minHeight: 640,
    title: 'Coffee Shop POS',
    backgroundColor: '#1a1410',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: false, resizable: true, fullscreenable: true, center: true,
  });

  mainWindow.loadFile('index.html');
  Menu.setApplicationMenu(null);
  if (isDev) mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.focus();
      }
    }, 300);
  });

  // Intercept system-level close (Alt+F4, taskbar close, etc.)
  mainWindow.on('close', (e) => {
    e.preventDefault();
    if (currentUser && currentUser !== 'system') {
      db.addActivityLog(0, currentUser, 'auth_logout', currentUser + ' sistemden çıkış yaptı');
    }
    mainWindow!.destroy();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Notify renderer when maximize state changes (for button icon)
  mainWindow.on('maximize',   () => mainWindow?.webContents.send('window:maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-change', false));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Başlatma ──────────────────────────────────

app.whenReady().then(() => {
  const ok = db.initDatabase();
  if (!ok) console.error('[MAIN] Veritabanı başlatılamadı! "npm run rebuild" çalıştırın.');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  db.closeDatabase();
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Veritabanı ───────────────────────────

ipcMain.handle('db:getAllOrders', () => {
  return db.getAllOrders();
});

ipcMain.handle('db:getVisibleOrders', () => {
  return db.getVisibleOrders();
});

ipcMain.handle('db:hideOrder', (_e, id: string) => {
  return db.hideOrder(id);
});

ipcMain.handle('db:saveOrder', (_e, sale: Parameters<typeof db.saveOrder>[0]) => {
  return db.saveOrder(sale);
});

ipcMain.handle('db:clearAllOrders', () => {
  return db.clearAllOrders();
});

// ── IPC: Dışa Aktarma ─────────────────────────

ipcMain.handle('db:exportCSV', async (_e, csvContent: string) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
    title: 'CSV Olarak Kaydet',
    defaultPath: `kahve-pos-satis-${stamp}.csv`,
    filters: [
      { name: 'CSV Dosyası', extensions: ['csv'] },
      { name: 'Tüm Dosyalar', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { ok: false, reason: 'canceled' };
  try {
    fs.writeFileSync(filePath, csvContent, 'utf8');
    return { ok: true, filePath };
  } catch (err: unknown) {
    return { ok: false, reason: (err as Error).message };
  }
});

ipcMain.handle('db:exportExcel', async (_e, htmlContent: string) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Excel Olarak Kaydet',
    defaultPath: `kahve-pos-satis-${stamp}.xls`,
    filters: [{ name: 'Excel', extensions: ['xls'] }],
  });
  if (canceled || !filePath) return { ok: false, reason: 'canceled' };
  try {
    fs.writeFileSync(filePath, htmlContent, 'utf8');
    return { ok: true, filePath };
  } catch (err: unknown) {
    return { ok: false, reason: (err as Error).message };
  }
});

// ── PDF Dışa Aktarma (Electron native printToPDF) ──────────────────
//
// html2canvas/html2pdf kullanmıyoruz — viewport scaling, zoom, DPI
// sorunlarının tamamı ortadan kalkar. Electron kendi Chromium
// render motorunu kullanarak HTML'i gerçek A4 sayfasına basar.

ipcMain.handle('db:exportPDF', async (_e, htmlContent: string) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
    title: 'PDF Raporu Kaydet',
    defaultPath: `Satis_Raporu_${stamp}.pdf`,
    filters: [{ name: 'PDF Dosyası', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, reason: 'canceled' };

  // Geçici HTML dosyası yaz (data: URI uzunluk sınırını aşmamak için)
  const tmpPath = path.join(app.getPath('temp'), `pos_pdf_${Date.now()}.html`);
  fs.writeFileSync(tmpPath, htmlContent, 'utf8');

  const pdfWin = new BrowserWindow({
    width: 1122,          // A4 yüksekliği px @ 96 dpi ≈ 1122
    height: 794,          // A4 genişliği px @ 96 dpi ≈ 794
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // PDF penceresinin preload'u yok — temiz, izole ortam
    },
  });

  try {
    await pdfWin.loadFile(tmpPath);

    // Grafik görselleri (base64 <img>) yüklenmesi için bekle
    await new Promise<void>(r => setTimeout(r, 1200));

    const pdfBuffer = await pdfWin.webContents.printToPDF({
      pageSize:        'A4',
      landscape:       false,
      printBackground: true,
      // @page CSS kuralımız 10mm margin tanımlıyor;
      // burada margin vermiyoruz ki çift margin olmasın.
      margins: { marginType: 'none' },
    });

    fs.writeFileSync(filePath, pdfBuffer);
    return { ok: true, filePath };
  } catch (err: unknown) {
    return { ok: false, reason: (err as Error).message };
  } finally {
    pdfWin.destroy();
    try { fs.unlinkSync(tmpPath); } catch { /* temp dosya silinemezse önemli değil */ }
  }
});

// ── IPC: Kullanıcı Yönetimi ───────────────────

ipcMain.handle('db:getUsers',   ()                                                    => db.getAllUsers());
ipcMain.handle('db:addUser',    (_e, u: string, p: string, r: string)                 => db.addUser(u, p, r));
ipcMain.handle('db:updateUser', (_e, id: number, u: string, p: string, r: string)    => db.updateUser(id, u, p, r));
ipcMain.handle('db:deleteUser', (_e, id: number)                                      => db.deleteUser(id));

// ── IPC: Aktivite Logları ─────────────────────

ipcMain.handle('db:addActivityLog',
  (_e, userId: number, username: string, actionType: string, description: string, details?: string | null) =>
    db.addActivityLog(userId, username, actionType, description, details));

ipcMain.handle('db:getActivityLogs',   ()               => db.getActivityLogs());
ipcMain.handle('db:deleteActivityLog', (_e, id: number) => db.deleteActivityLog(id));
ipcMain.handle('db:clearActivityLogs', ()               => db.clearActivityLogs());

// ── IPC: Envanter ─────────────────────────────
ipcMain.handle('db:getInventory',    ()                            => db.getInventory());
ipcMain.handle('db:upsertInventory', (_e, name, qty, min, cat)    => db.upsertInventory(name, qty, min, cat));
ipcMain.handle('db:deductStock',     (_e, items)                  => db.deductStock(items));
ipcMain.handle('db:restoreStock',    (_e, items)                  => db.restoreStock(items));
ipcMain.handle('db:addStock',        (_e, name, qty, cat)         => db.addStock(name, qty, cat));

// ── IPC: Pencere ──────────────────────────────

ipcMain.on('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else                          mainWindow.maximize();
});

// Custom X button (renderer confirmed exit): log and destroy
ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (currentUser && currentUser !== 'system') {
      db.addActivityLog(0, currentUser, 'auth_logout', currentUser + ' sistemden çıkış yaptı');
    }
    mainWindow.destroy();
  }
});

// Keep current user in sync for exit logging
ipcMain.on('session:set-user', (_e, username: string) => {
  currentUser = username || 'system';
});

ipcMain.on('toggle-fullscreen', () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on('focus-window', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
});

ipcMain.on('quit-app', () => { app.quit(); });

ipcMain.handle('create-shortcut', async () => {
  try {
    const exePath = app.getPath('exe');
    const desktop = app.getPath('desktop');
    if (process.platform === 'win32') {
      const shortcutPath = path.join(desktop, 'Coffee Shop POS.lnk');
      const ps = `$WS=New-Object -ComObject WScript.Shell;$SC=$WS.CreateShortcut('${shortcutPath.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}');$SC.TargetPath='${exePath.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}';$SC.Description='Coffee Shop POS';$SC.Save()`;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('child_process').execSync(`powershell -Command "${ps}"`);
      return { ok: true };
    } else if (process.platform === 'linux') {
      const sc = path.join(desktop, 'coffee-shop-pos.desktop');
      fs.writeFileSync(sc, `[Desktop Entry]\nType=Application\nName=Coffee Shop POS\nExec=${exePath}\nIcon=${path.join(__dirname,'assets','icon.png')}\nTerminal=false\n`);
      fs.chmodSync(sc, '0755');
      return { ok: true };
    }
    return { ok: false, msg: 'macOS: Dock üzerinden ekleyin.' };
  } catch (err: unknown) {
    return { ok: false, msg: (err as Error).message };
  }
});
