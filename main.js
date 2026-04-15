/* =============================================
   COFFEE SHOP POS — main.ts (Electron)
   ============================================= */
'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const db = __importStar(require("./database"));
const isDev = process.env.NODE_ENV === 'development';
electron_1.app.setName('Coffee Shop POS');
let mainWindow = null;
let currentUser = 'system';
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    electron_1.Menu.setApplicationMenu(null);
    if (isDev)
        mainWindow.webContents.openDevTools();
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
        mainWindow.destroy();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    // Notify renderer when maximize state changes (for button icon)
    mainWindow.on('maximize', () => mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.webContents.send('window:maximized-change', true));
    mainWindow.on('unmaximize', () => mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.webContents.send('window:maximized-change', false));
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
}
// ── Başlatma ──────────────────────────────────
electron_1.app.whenReady().then(() => {
    const ok = db.initDatabase();
    if (!ok)
        console.error('[MAIN] Veritabanı başlatılamadı! "npm run rebuild" çalıştırın.');
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    db.closeDatabase();
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
// ── IPC: Veritabanı ───────────────────────────
electron_1.ipcMain.handle('db:getAllOrders', () => {
    return db.getAllOrders();
});
electron_1.ipcMain.handle('db:getVisibleOrders', () => {
    return db.getVisibleOrders();
});
electron_1.ipcMain.handle('db:hideOrder', (_e, id) => {
    return db.hideOrder(id);
});
electron_1.ipcMain.handle('db:saveOrder', (_e, sale) => {
    return db.saveOrder(sale);
});
electron_1.ipcMain.handle('db:clearAllOrders', () => {
    return db.clearAllOrders();
});
// ── IPC: Dışa Aktarma ─────────────────────────
electron_1.ipcMain.handle('db:exportCSV', async (_e, csvContent) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const { filePath, canceled } = await electron_1.dialog.showSaveDialog(mainWindow, {
        title: 'CSV Olarak Kaydet',
        defaultPath: `kahve-pos-satis-${stamp}.csv`,
        filters: [
            { name: 'CSV Dosyası', extensions: ['csv'] },
            { name: 'Tüm Dosyalar', extensions: ['*'] },
        ],
    });
    if (canceled || !filePath)
        return { ok: false, reason: 'canceled' };
    try {
        fs.writeFileSync(filePath, csvContent, 'utf8');
        return { ok: true, filePath };
    }
    catch (err) {
        return { ok: false, reason: err.message };
    }
});
electron_1.ipcMain.handle('db:exportExcel', async (_e, htmlContent) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const { filePath, canceled } = await electron_1.dialog.showSaveDialog(mainWindow, {
        title: 'Excel Olarak Kaydet',
        defaultPath: `kahve-pos-satis-${stamp}.xls`,
        filters: [{ name: 'Excel', extensions: ['xls'] }],
    });
    if (canceled || !filePath)
        return { ok: false, reason: 'canceled' };
    try {
        fs.writeFileSync(filePath, htmlContent, 'utf8');
        return { ok: true, filePath };
    }
    catch (err) {
        return { ok: false, reason: err.message };
    }
});
// ── PDF Dışa Aktarma (Electron native printToPDF) ──────────────────
//
// html2canvas/html2pdf kullanmıyoruz — viewport scaling, zoom, DPI
// sorunlarının tamamı ortadan kalkar. Electron kendi Chromium
// render motorunu kullanarak HTML'i gerçek A4 sayfasına basar.
electron_1.ipcMain.handle('db:exportPDF', async (_e, htmlContent) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const { filePath, canceled } = await electron_1.dialog.showSaveDialog(mainWindow, {
        title: 'PDF Raporu Kaydet',
        defaultPath: `Satis_Raporu_${stamp}.pdf`,
        filters: [{ name: 'PDF Dosyası', extensions: ['pdf'] }],
    });
    if (canceled || !filePath)
        return { ok: false, reason: 'canceled' };
    // Geçici HTML dosyası yaz (data: URI uzunluk sınırını aşmamak için)
    const tmpPath = path.join(electron_1.app.getPath('temp'), `pos_pdf_${Date.now()}.html`);
    fs.writeFileSync(tmpPath, htmlContent, 'utf8');
    const pdfWin = new electron_1.BrowserWindow({
        width: 1122, // A4 yüksekliği px @ 96 dpi ≈ 1122
        height: 794, // A4 genişliği px @ 96 dpi ≈ 794
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
        await new Promise(r => setTimeout(r, 1200));
        const pdfBuffer = await pdfWin.webContents.printToPDF({
            pageSize: 'A4',
            landscape: false,
            printBackground: true,
            // @page CSS kuralımız 10mm margin tanımlıyor;
            // burada margin vermiyoruz ki çift margin olmasın.
            margins: { marginType: 'none' },
        });
        fs.writeFileSync(filePath, pdfBuffer);
        return { ok: true, filePath };
    }
    catch (err) {
        return { ok: false, reason: err.message };
    }
    finally {
        pdfWin.destroy();
        try {
            fs.unlinkSync(tmpPath);
        }
        catch ( /* temp dosya silinemezse önemli değil */_a) { /* temp dosya silinemezse önemli değil */ }
    }
});
// ── IPC: Kullanıcı Yönetimi ───────────────────
electron_1.ipcMain.handle('db:getUsers', () => db.getAllUsers());
electron_1.ipcMain.handle('db:addUser', (_e, u, p, r) => db.addUser(u, p, r));
electron_1.ipcMain.handle('db:updateUser', (_e, id, u, p, r) => db.updateUser(id, u, p, r));
electron_1.ipcMain.handle('db:deleteUser', (_e, id) => db.deleteUser(id));
// ── IPC: Aktivite Logları ─────────────────────
electron_1.ipcMain.handle('db:addActivityLog', (_e, userId, username, actionType, description, details) => db.addActivityLog(userId, username, actionType, description, details));
electron_1.ipcMain.handle('db:getActivityLogs', () => db.getActivityLogs());
electron_1.ipcMain.handle('db:deleteActivityLog', (_e, id) => db.deleteActivityLog(id));
electron_1.ipcMain.handle('db:clearActivityLogs', () => db.clearActivityLogs());
// ── IPC: Envanter ─────────────────────────────
electron_1.ipcMain.handle('db:getInventory', () => db.getInventory());
electron_1.ipcMain.handle('db:upsertInventory', (_e, name, qty, min, cat) => db.upsertInventory(name, qty, min, cat));
electron_1.ipcMain.handle('db:deductStock', (_e, items) => db.deductStock(items));
electron_1.ipcMain.handle('db:restoreStock', (_e, items) => db.restoreStock(items));
electron_1.ipcMain.handle('db:addStock', (_e, name, qty, cat) => db.addStock(name, qty, cat));
// ── IPC: Pencere ──────────────────────────────
electron_1.ipcMain.on('window:minimize', () => {
    mainWindow === null || mainWindow === void 0 ? void 0 : mainWindow.minimize();
});
electron_1.ipcMain.on('window:maximize', () => {
    if (!mainWindow)
        return;
    if (mainWindow.isMaximized())
        mainWindow.unmaximize();
    else
        mainWindow.maximize();
});
// Custom X button (renderer confirmed exit): log and destroy
electron_1.ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (currentUser && currentUser !== 'system') {
            db.addActivityLog(0, currentUser, 'auth_logout', currentUser + ' sistemden çıkış yaptı');
        }
        mainWindow.destroy();
    }
});
// Keep current user in sync for exit logging
electron_1.ipcMain.on('session:set-user', (_e, username) => {
    currentUser = username || 'system';
});
electron_1.ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow)
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
});
electron_1.ipcMain.on('focus-window', () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.focus();
    }
});
electron_1.ipcMain.on('quit-app', () => { electron_1.app.quit(); });
electron_1.ipcMain.handle('create-shortcut', async () => {
    try {
        const exePath = electron_1.app.getPath('exe');
        const desktop = electron_1.app.getPath('desktop');
        if (process.platform === 'win32') {
            const shortcutPath = path.join(desktop, 'Coffee Shop POS.lnk');
            const ps = `$WS=New-Object -ComObject WScript.Shell;$SC=$WS.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');$SC.TargetPath='${exePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';$SC.Description='Coffee Shop POS';$SC.Save()`;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('child_process').execSync(`powershell -Command "${ps}"`);
            return { ok: true };
        }
        else if (process.platform === 'linux') {
            const sc = path.join(desktop, 'coffee-shop-pos.desktop');
            fs.writeFileSync(sc, `[Desktop Entry]\nType=Application\nName=Coffee Shop POS\nExec=${exePath}\nIcon=${path.join(__dirname, 'assets', 'icon.png')}\nTerminal=false\n`);
            fs.chmodSync(sc, '0755');
            return { ok: true };
        }
        return { ok: false, msg: 'macOS: Dock üzerinden ekleyin.' };
    }
    catch (err) {
        return { ok: false, msg: err.message };
    }
});
