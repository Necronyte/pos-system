/* =============================================
   KAHVE POS — database.ts
   better-sqlite3 — senkron SQLite
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
exports.initDatabase = initDatabase;
exports.saveOrder = saveOrder;
exports.getAllOrders = getAllOrders;
exports.getVisibleOrders = getVisibleOrders;
exports.hideOrder = hideOrder;
exports.clearAllOrders = clearAllOrders;
exports.getAllUsers = getAllUsers;
exports.addUser = addUser;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
exports.addActivityLog = addActivityLog;
exports.getActivityLogs = getActivityLogs;
exports.deleteActivityLog = deleteActivityLog;
exports.clearActivityLogs = clearActivityLogs;
exports.getInventory = getInventory;
exports.upsertInventory = upsertInventory;
exports.deductStock = deductStock;
exports.addStock = addStock;
exports.restoreStock = restoreStock;
exports.closeDatabase = closeDatabase;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
// ── Module state ──────────────────────────────
let db = null;
let dbPath = null;
// ── BAŞLATMA ──────────────────────────────────
function initDatabase() {
    let DatabaseCtor;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        DatabaseCtor = require('better-sqlite3');
    }
    catch (err) {
        console.error('[DB] better-sqlite3 yüklenemedi:', err.message);
        return false;
    }
    const userDataPath = electron_1.app.getPath('userData');
    dbPath = path.join(userDataPath, 'kahve-pos.db');
    if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
    }
    console.log('[DB] Veritabanı yolu:', dbPath);
    try {
        db = new DatabaseCtor(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        createTables();
        migrateSchema();
        seedDefaultUsers();
        console.log('[DB] Hazır. (better-sqlite3)');
        return true;
    }
    catch (err) {
        console.error('[DB] Açılamadı:', err.message);
        return false;
    }
}
// ── TABLOLAR ──────────────────────────────────
function createTables() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id                  TEXT PRIMARY KEY,
      datetime            TEXT NOT NULL,
      subtotal            INTEGER NOT NULL,
      tax                 INTEGER NOT NULL,
      discount_amount     INTEGER NOT NULL DEFAULT 0,
      total               INTEGER NOT NULL,
      payment_type        TEXT NOT NULL DEFAULT 'cash',
      cash_amount         INTEGER NOT NULL DEFAULT 0,
      card_amount         INTEGER NOT NULL DEFAULT 0,
      visible_in_history  INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      icon       TEXT NOT NULL DEFAULT '☕',
      qty        INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      line_total INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_item_extras (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id    INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      extra_name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_dt  ON orders(datetime);
    CREATE INDEX IF NOT EXISTS idx_items_oid  ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_extras_iid ON order_item_extras(item_id);
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    NOT NULL UNIQUE,
      password   TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'staff',
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS activity_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL DEFAULT 0,
      username    TEXT    NOT NULL,
      action_type TEXT    NOT NULL,
      description TEXT    NOT NULL,
      timestamp   TEXT    NOT NULL,
      is_deleted  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts   ON activity_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_user ON activity_logs(username);
    CREATE TABLE IF NOT EXISTS inventory (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name     TEXT    NOT NULL UNIQUE,
      stock_quantity   INTEGER NOT NULL DEFAULT 0,
      min_stock_level  INTEGER NOT NULL DEFAULT 5,
      category         TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_inv_name ON inventory(product_name);
  `);
}
// ── ŞEMA MİGRASYONU ───────────────────────────
function migrateSchema() {
    const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
    if (!cols.includes('payment_type')) {
        db.exec("ALTER TABLE orders ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'cash'");
        console.log('[DB] Migrasyon: payment_type eklendi');
    }
    if (!cols.includes('cash_amount')) {
        db.exec('ALTER TABLE orders ADD COLUMN cash_amount INTEGER NOT NULL DEFAULT 0');
        console.log('[DB] Migrasyon: cash_amount eklendi');
    }
    if (!cols.includes('card_amount')) {
        db.exec('ALTER TABLE orders ADD COLUMN card_amount INTEGER NOT NULL DEFAULT 0');
        console.log('[DB] Migrasyon: card_amount eklendi');
    }
    if (!cols.includes('discount_amount')) {
        db.exec('ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0');
        console.log('[DB] Migrasyon: discount_amount eklendi');
    }
    if (!cols.includes('visible_in_history')) {
        db.exec('ALTER TABLE orders ADD COLUMN visible_in_history INTEGER NOT NULL DEFAULT 1');
        console.log('[DB] Migrasyon: visible_in_history eklendi');
    }
    if (!cols.includes('is_stock_deducted')) {
        db.exec('ALTER TABLE orders ADD COLUMN is_stock_deducted INTEGER NOT NULL DEFAULT 0');
        console.log('[DB] Migrasyon: orders.is_stock_deducted eklendi');
    }
    // users.is_deleted migration
    const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!userCols.includes('is_deleted')) {
        db.exec('ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
        console.log('[DB] Migrasyon: users.is_deleted eklendi');
    }
    // Ensure activity_logs exists for databases created before this feature
    const logTableInfo = db.prepare('PRAGMA table_info(activity_logs)').all();
    if (logTableInfo.length === 0) {
        db.exec(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL DEFAULT 0,
        username    TEXT    NOT NULL,
        action_type TEXT    NOT NULL,
        description TEXT    NOT NULL,
        details     TEXT,
        timestamp   TEXT    NOT NULL,
        is_deleted  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_logs_ts   ON activity_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_user ON activity_logs(username);
    `);
        console.log('[DB] Migrasyon: activity_logs tablosu oluşturuldu');
    }
    else {
        const logCols = logTableInfo.map((c) => c.name);
        if (!logCols.includes('details')) {
            db.exec('ALTER TABLE activity_logs ADD COLUMN details TEXT');
            console.log('[DB] Migrasyon: activity_logs.details eklendi');
        }
        if (!logCols.includes('is_deleted')) {
            db.exec('ALTER TABLE activity_logs ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
            console.log('[DB] Migrasyon: activity_logs.is_deleted eklendi');
        }
    }
}
// ── SİPARİŞ KAYDET ────────────────────────────
function saveOrder(sale) {
    if (!db) {
        console.error('[DB] saveOrder: db null.');
        return false;
    }
    try {
        const insertOrder = db.prepare('INSERT INTO orders (id, datetime, subtotal, tax, discount_amount, total, payment_type, cash_amount, card_amount) VALUES (?,?,?,?,?,?,?,?,?)');
        const insertItem = db.prepare('INSERT INTO order_items (order_id, name, icon, qty, unit_price, line_total) VALUES (?,?,?,?,?,?)');
        const insertExtra = db.prepare('INSERT INTO order_item_extras (item_id, extra_name) VALUES (?,?)');
        const run = db.transaction(() => {
            insertOrder.run(sale.id, sale.datetime, sale.subtotal, sale.tax, sale.discountAmount || 0, sale.total, sale.paymentType || 'cash', sale.cashAmount || 0, sale.cardAmount || 0);
            for (const item of sale.items) {
                const info = insertItem.run(sale.id, item.name, item.icon || '☕', item.qty, item.unitPrice, item.lineTotal);
                const itemId = info.lastInsertRowid;
                for (const extra of (item.extras || [])) {
                    insertExtra.run(itemId, extra);
                }
            }
        });
        run();
        console.log('[DB] Kaydedildi:', sale.id, '|', sale.paymentType);
        return true;
    }
    catch (err) {
        console.error('[DB] Kayıt hatası:', err.message);
        return false;
    }
}
// ── SİPARİŞ YÜKLEYİCİ (İÇ YARDIMCI) ────────
function fetchOrders(whereClause) {
    const orders = db.prepare('SELECT id, datetime, subtotal, tax, discount_amount, total, payment_type, cash_amount, card_amount FROM orders' +
        whereClause +
        ' ORDER BY datetime ASC').all();
    const getItems = db.prepare('SELECT id, name, icon, qty, unit_price, line_total FROM order_items WHERE order_id = ?');
    const getExtras = db.prepare('SELECT extra_name FROM order_item_extras WHERE item_id = ?');
    return orders.map(o => ({
        id: o.id,
        datetime: o.datetime,
        subtotal: o.subtotal,
        tax: o.tax,
        discountAmount: o.discount_amount || 0,
        total: o.total,
        paymentType: o.payment_type || 'cash',
        cashAmount: o.cash_amount || 0,
        cardAmount: o.card_amount || 0,
        items: getItems.all(o.id).map(it => ({
            name: it.name,
            icon: it.icon,
            qty: it.qty,
            unitPrice: it.unit_price,
            lineTotal: it.line_total,
            extras: getExtras.all(it.id).map(e => e.extra_name),
        })),
    }));
}
// ── TÜM SİPARİŞLERİ YÜKLE (ANALİTİK — visible_in_history'den bağımsız) ──
function getAllOrders() {
    if (!db)
        return [];
    try {
        return fetchOrders('');
    }
    catch (err) {
        console.error('[DB] Yükleme hatası:', err.message);
        return [];
    }
}
// ── GEÇMİŞTE GÖRÜNÜR SİPARİŞLERİ YÜKLE ──────
function getVisibleOrders() {
    if (!db)
        return [];
    try {
        return fetchOrders(' WHERE visible_in_history = 1');
    }
    catch (err) {
        console.error('[DB] Yükleme hatası:', err.message);
        return [];
    }
}
// ── SİPARİŞİ GEÇMİŞTEN GİZLE (SOFT DELETE) ──
function hideOrder(id) {
    if (!db)
        return false;
    try {
        db.prepare('UPDATE orders SET visible_in_history = 0 WHERE id = ?').run(id);
        return true;
    }
    catch (err) {
        console.error('[DB] hideOrder hatası:', err.message);
        return false;
    }
}
// ── TÜM GEÇMİŞİ SİL ──────────────────────────
function clearAllOrders() {
    if (!db)
        return false;
    try {
        db.exec('UPDATE orders SET visible_in_history = 0');
        return true;
    }
    catch (err) {
        console.error('[DB] clearAllOrders hatası:', err.message);
        return false;
    }
}
// ── KULLANICI SEED ────────────────────────────
function seedDefaultUsers() {
    const seed = db.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)');
    seed.run('admin', '1234', 'admin');
    seed.run('Tolga', 'abcd', 'staff');
    seed.run('Ayşe', 'efgh', 'staff');
}
// ── KULLANICI CRUD ────────────────────────────
function getAllUsers() {
    if (!db)
        return [];
    try {
        return db.prepare('SELECT id, username, password, role FROM users WHERE is_deleted = 0 ORDER BY id ASC').all()
            .map(u => ({ id: u.id, username: u.username, password: u.password, role: u.role }));
    }
    catch (err) {
        console.error('[DB] getAllUsers hatası:', err.message);
        return [];
    }
}
function addUser(username, password, role) {
    if (!db)
        return { ok: false, error: 'DB bağlantısı yok' };
    if (!username.trim() || !password.trim())
        return { ok: false, error: 'Kullanıcı adı ve şifre boş olamaz.' };
    try {
        db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username.trim(), password, role);
        return { ok: true };
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes('UNIQUE'))
            return { ok: false, error: 'Bu kullanıcı adı zaten mevcut.' };
        return { ok: false, error: msg };
    }
}
function updateUser(id, username, password, role) {
    if (!db)
        return { ok: false, error: 'DB bağlantısı yok' };
    if (!username.trim() || !password.trim())
        return { ok: false, error: 'Kullanıcı adı ve şifre boş olamaz.' };
    try {
        const info = db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ? AND is_deleted = 0')
            .run(username.trim(), password, role, id);
        if (info.changes === 0)
            return { ok: false, error: 'Kullanıcı bulunamadı.' };
        return { ok: true };
    }
    catch (err) {
        const msg = err.message;
        if (msg.includes('UNIQUE'))
            return { ok: false, error: 'Bu kullanıcı adı zaten mevcut.' };
        return { ok: false, error: msg };
    }
}
function deleteUser(id) {
    if (!db)
        return { ok: false, error: 'DB bağlantısı yok' };
    try {
        const user = db.prepare('SELECT role FROM users WHERE id = ? AND is_deleted = 0').get(id);
        if (!user)
            return { ok: false, error: 'Kullanıcı bulunamadı.' };
        if (user.role === 'admin') {
            const cnt = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND is_deleted = 0").get().cnt;
            if (cnt <= 1)
                return { ok: false, error: 'Son yönetici hesabı silinemez.' };
        }
        db.prepare('UPDATE users SET is_deleted = 1 WHERE id = ?').run(id);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
// ── AKTİVİTE LOGLARI ─────────────────────────
function addActivityLog(userId, username, actionType, description, details) {
    if (!db)
        return false;
    try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const ts = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
            pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        db.prepare('INSERT INTO activity_logs (user_id, username, action_type, description, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, username, actionType, description, details !== null && details !== void 0 ? details : null, ts);
        return true;
    }
    catch (err) {
        console.error('[DB] addActivityLog hatası:', err.message);
        return false;
    }
}
function getActivityLogs() {
    if (!db)
        return [];
    try {
        return db.prepare('SELECT id, user_id, username, action_type, description, details, timestamp FROM activity_logs WHERE is_deleted = 0 ORDER BY id DESC').all();
    }
    catch (err) {
        console.error('[DB] getActivityLogs hatası:', err.message);
        return [];
    }
}
function deleteActivityLog(id) {
    if (!db)
        return false;
    try {
        db.prepare('UPDATE activity_logs SET is_deleted = 1 WHERE id = ?').run(id);
        return true;
    }
    catch (err) {
        console.error('[DB] deleteActivityLog hatası:', err.message);
        return false;
    }
}
function clearActivityLogs() {
    if (!db)
        return false;
    try {
        db.exec('UPDATE activity_logs SET is_deleted = 1');
        return true;
    }
    catch (err) {
        console.error('[DB] clearActivityLogs hatası:', err.message);
        return false;
    }
}
// ── ENVANTER CRUD ─────────────────────────────
function getInventory() {
    if (!db)
        return [];
    try {
        return db.prepare('SELECT id, product_name, stock_quantity, min_stock_level, category FROM inventory ORDER BY category, product_name').all();
    }
    catch (err) {
        console.error('[DB] getInventory hatası:', err.message);
        return [];
    }
}
function upsertInventory(productName, stockQty, minStockLevel, category) {
    if (!db)
        return false;
    try {
        db.prepare('INSERT INTO inventory (product_name, stock_quantity, min_stock_level, category) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(product_name) DO UPDATE SET stock_quantity = ?, min_stock_level = ?, category = ?').run(productName, stockQty, minStockLevel, category, stockQty, minStockLevel, category);
        return true;
    }
    catch (err) {
        console.error('[DB] upsertInventory hatası:', err.message);
        return false;
    }
}
function deductStock(items) {
    if (!db)
        return { ok: false, depleted: [] };
    try {
        const depleted = [];
        const txn = db.transaction((rows) => {
            for (const row of rows) {
                const inv = db.prepare('SELECT stock_quantity FROM inventory WHERE product_name = ?').get(row.name);
                if (!inv)
                    continue;
                if (inv.stock_quantity < row.qty) {
                    // Deduct whatever is left (down to 0)
                    db.prepare('UPDATE inventory SET stock_quantity = 0 WHERE product_name = ?').run(row.name);
                    depleted.push(row.name);
                }
                else {
                    db.prepare('UPDATE inventory SET stock_quantity = stock_quantity - ? WHERE product_name = ?').run(row.qty, row.name);
                    // Check if now depleted
                    const after = db.prepare('SELECT stock_quantity FROM inventory WHERE product_name = ?').get(row.name);
                    if (after && after.stock_quantity <= 0)
                        depleted.push(row.name);
                }
            }
        });
        txn(items);
        return { ok: true, depleted };
    }
    catch (err) {
        console.error('[DB] deductStock hatası:', err.message);
        return { ok: false, depleted: [] };
    }
}
function addStock(name, qty, category) {
    if (!db)
        return false;
    try {
        db.prepare('INSERT INTO inventory (product_name, stock_quantity, min_stock_level, category) VALUES (?, ?, 5, ?) ' +
            'ON CONFLICT(product_name) DO UPDATE SET stock_quantity = inventory.stock_quantity + excluded.stock_quantity').run(name, qty, category);
        return true;
    }
    catch (err) {
        console.error('[DB] addStock hatası:', err.message);
        return false;
    }
}
function restoreStock(items) {
    if (!db)
        return false;
    try {
        const txn = db.transaction((rows) => {
            for (const row of rows) {
                db.prepare('UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE product_name = ?').run(row.qty, row.name);
            }
        });
        txn(items);
        return true;
    }
    catch (err) {
        console.error('[DB] restoreStock hatası:', err.message);
        return false;
    }
}
// ── KAPAT ─────────────────────────────────────
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log('[DB] Kapatıldı.');
    }
}
