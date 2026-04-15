/* =============================================
   KAHVE POS — database.ts
   better-sqlite3 — senkron SQLite
   ============================================= */

'use strict';

import * as path from 'path';
import * as fs   from 'fs';
import { app }   from 'electron';
import type BetterSqlite3 from 'better-sqlite3';

// ── Row shapes returned by SQLite ─────────────

interface OrderRow {
  id:              string;
  datetime:        string;
  subtotal:        number;
  tax:             number;
  discount_amount: number;
  total:           number;
  payment_type:    string;
  cash_amount:     number;
  card_amount:     number;
}

interface ItemRow {
  id:         number;
  name:       string;
  icon:       string;
  qty:        number;
  unit_price: number;
  line_total: number;
}

interface ExtraRow {
  extra_name: string;
}

interface PragmaColumnRow {
  name: string;
}

interface UserRow {
  id:       number;
  username: string;
  password: string;
  role:     string;
}

export interface DbUser {
  id:       number;
  username: string;
  password: string;
  role:     'admin' | 'staff';
}

export interface DbUserResult {
  ok:     boolean;
  error?: string;
}

export interface DbActivityLog {
  id:          number;
  user_id:     number;
  username:    string;
  action_type: string;
  details:     string | null;
  description: string;
  timestamp:   string;
}

// ── Inventory row shape ───────────────────────

export interface DbInventoryItem {
  id:              number;
  product_name:    string;
  stock_quantity:  number;
  min_stock_level: number;
  category:        string;
}

export interface DeductStockResult {
  ok:       boolean;
  depleted: string[];
}

// ── Public shape emitted by getAllOrders ───────

export interface DbSaleItem {
  name:      string;
  icon:      string;
  qty:       number;
  unitPrice: number;
  lineTotal: number;
  extras:    string[];
}

export interface DbSaleRecord {
  id:             string;
  datetime:       string;
  subtotal:       number;
  tax:            number;
  discountAmount: number;
  total:          number;
  paymentType:    string;
  cashAmount:     number;
  cardAmount:     number;
  items:          DbSaleItem[];
}

export interface DbSaleInput extends Omit<DbSaleRecord, 'items'> {
  tableId?:   string;
  tableName?: string;
  items: Array<{
    name:      string;
    icon:      string;
    qty:       number;
    unitPrice: number;
    lineTotal: number;
    extras:    string[];
  }>;
  cashAmount: number;
  cardAmount: number;
}

// ── Module state ──────────────────────────────

let db:     BetterSqlite3.Database | null = null;
let dbPath: string | null                 = null;

// ── BAŞLATMA ──────────────────────────────────

export function initDatabase(): boolean {
  let DatabaseCtor: typeof BetterSqlite3;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    DatabaseCtor = require('better-sqlite3') as typeof BetterSqlite3;
  } catch (err: unknown) {
    console.error('[DB] better-sqlite3 yüklenemedi:', (err as Error).message);
    return false;
  }

  const userDataPath = app.getPath('userData');
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
  } catch (err: unknown) {
    console.error('[DB] Açılamadı:', (err as Error).message);
    return false;
  }
}

// ── TABLOLAR ──────────────────────────────────

function createTables(): void {
  db!.exec(`
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

function migrateSchema(): void {
  const cols = (db!.prepare('PRAGMA table_info(orders)').all() as PragmaColumnRow[]).map(c => c.name);
  if (!cols.includes('payment_type')) {
    db!.exec("ALTER TABLE orders ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'cash'");
    console.log('[DB] Migrasyon: payment_type eklendi');
  }
  if (!cols.includes('cash_amount')) {
    db!.exec('ALTER TABLE orders ADD COLUMN cash_amount INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrasyon: cash_amount eklendi');
  }
  if (!cols.includes('card_amount')) {
    db!.exec('ALTER TABLE orders ADD COLUMN card_amount INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrasyon: card_amount eklendi');
  }
  if (!cols.includes('discount_amount')) {
    db!.exec('ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrasyon: discount_amount eklendi');
  }
  if (!cols.includes('visible_in_history')) {
    db!.exec('ALTER TABLE orders ADD COLUMN visible_in_history INTEGER NOT NULL DEFAULT 1');
    console.log('[DB] Migrasyon: visible_in_history eklendi');
  }
  if (!cols.includes('is_stock_deducted')) {
    db!.exec('ALTER TABLE orders ADD COLUMN is_stock_deducted INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrasyon: orders.is_stock_deducted eklendi');
  }
  // users.is_deleted migration
  const userCols = (db!.prepare('PRAGMA table_info(users)').all() as PragmaColumnRow[]).map(c => c.name);
  if (!userCols.includes('is_deleted')) {
    db!.exec('ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrasyon: users.is_deleted eklendi');
  }

  // Ensure activity_logs exists for databases created before this feature
  const logTableInfo = (db!.prepare('PRAGMA table_info(activity_logs)').all() as PragmaColumnRow[]);
  if (logTableInfo.length === 0) {
    db!.exec(`
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
  } else {
    const logCols = logTableInfo.map((c: PragmaColumnRow) => c.name);
    if (!logCols.includes('details')) {
      db!.exec('ALTER TABLE activity_logs ADD COLUMN details TEXT');
      console.log('[DB] Migrasyon: activity_logs.details eklendi');
    }
    if (!logCols.includes('is_deleted')) {
      db!.exec('ALTER TABLE activity_logs ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0');
      console.log('[DB] Migrasyon: activity_logs.is_deleted eklendi');
    }
  }
}

// ── SİPARİŞ KAYDET ────────────────────────────

export function saveOrder(sale: DbSaleInput): boolean {
  if (!db) {
    console.error('[DB] saveOrder: db null.');
    return false;
  }
  try {
    const insertOrder = db.prepare(
      'INSERT INTO orders (id, datetime, subtotal, tax, discount_amount, total, payment_type, cash_amount, card_amount) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    const insertItem  = db.prepare(
      'INSERT INTO order_items (order_id, name, icon, qty, unit_price, line_total) VALUES (?,?,?,?,?,?)'
    );
    const insertExtra = db.prepare(
      'INSERT INTO order_item_extras (item_id, extra_name) VALUES (?,?)'
    );

    const run = db.transaction(() => {
      insertOrder.run(
        sale.id, sale.datetime, sale.subtotal, sale.tax,
        sale.discountAmount || 0,
        sale.total,
        sale.paymentType  || 'cash',
        sale.cashAmount   || 0,
        sale.cardAmount   || 0,
      );
      for (const item of sale.items) {
        const info   = insertItem.run(sale.id, item.name, item.icon || '☕', item.qty, item.unitPrice, item.lineTotal);
        const itemId = info.lastInsertRowid;
        for (const extra of (item.extras || [])) {
          insertExtra.run(itemId, extra);
        }
      }
    });

    run();
    console.log('[DB] Kaydedildi:', sale.id, '|', sale.paymentType);
    return true;
  } catch (err: unknown) {
    console.error('[DB] Kayıt hatası:', (err as Error).message);
    return false;
  }
}

// ── SİPARİŞ YÜKLEYİCİ (İÇ YARDIMCI) ────────

function fetchOrders(whereClause: string): DbSaleRecord[] {
  const orders = db!.prepare(
    'SELECT id, datetime, subtotal, tax, discount_amount, total, payment_type, cash_amount, card_amount FROM orders' +
    whereClause +
    ' ORDER BY datetime ASC'
  ).all() as OrderRow[];

  const getItems  = db!.prepare('SELECT id, name, icon, qty, unit_price, line_total FROM order_items WHERE order_id = ?');
  const getExtras = db!.prepare('SELECT extra_name FROM order_item_extras WHERE item_id = ?');

  return orders.map(o => ({
    id:             o.id,
    datetime:       o.datetime,
    subtotal:       o.subtotal,
    tax:            o.tax,
    discountAmount: o.discount_amount || 0,
    total:          o.total,
    paymentType:    o.payment_type  || 'cash',
    cashAmount:     o.cash_amount   || 0,
    cardAmount:     o.card_amount   || 0,
    items: (getItems.all(o.id) as ItemRow[]).map(it => ({
      name:      it.name,
      icon:      it.icon,
      qty:       it.qty,
      unitPrice: it.unit_price,
      lineTotal: it.line_total,
      extras:    (getExtras.all(it.id) as ExtraRow[]).map(e => e.extra_name),
    })),
  }));
}

// ── TÜM SİPARİŞLERİ YÜKLE (ANALİTİK — visible_in_history'den bağımsız) ──

export function getAllOrders(): DbSaleRecord[] {
  if (!db) return [];
  try {
    return fetchOrders('');
  } catch (err: unknown) {
    console.error('[DB] Yükleme hatası:', (err as Error).message);
    return [];
  }
}

// ── GEÇMİŞTE GÖRÜNÜR SİPARİŞLERİ YÜKLE ──────

export function getVisibleOrders(): DbSaleRecord[] {
  if (!db) return [];
  try {
    return fetchOrders(' WHERE visible_in_history = 1');
  } catch (err: unknown) {
    console.error('[DB] Yükleme hatası:', (err as Error).message);
    return [];
  }
}

// ── SİPARİŞİ GEÇMİŞTEN GİZLE (SOFT DELETE) ──

export function hideOrder(id: string): boolean {
  if (!db) return false;
  try {
    db.prepare('UPDATE orders SET visible_in_history = 0 WHERE id = ?').run(id);
    return true;
  } catch (err: unknown) {
    console.error('[DB] hideOrder hatası:', (err as Error).message);
    return false;
  }
}

// ── TÜM GEÇMİŞİ SİL ──────────────────────────

export function clearAllOrders(): boolean {
  if (!db) return false;
  try {
    db.exec('UPDATE orders SET visible_in_history = 0');
    return true;
  } catch (err: unknown) {
    console.error('[DB] clearAllOrders hatası:', (err as Error).message);
    return false;
  }
}

// ── KULLANICI SEED ────────────────────────────

function seedDefaultUsers(): void {
  const seed = db!.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)');
  seed.run('admin', '1234', 'admin');
  seed.run('Tolga', 'abcd', 'staff');
  seed.run('Ayşe',  'efgh', 'staff');
}

// ── KULLANICI CRUD ────────────────────────────

export function getAllUsers(): DbUser[] {
  if (!db) return [];
  try {
    return (db.prepare('SELECT id, username, password, role FROM users WHERE is_deleted = 0 ORDER BY id ASC').all() as UserRow[])
      .map(u => ({ id: u.id, username: u.username, password: u.password, role: u.role as 'admin' | 'staff' }));
  } catch (err: unknown) {
    console.error('[DB] getAllUsers hatası:', (err as Error).message);
    return [];
  }
}

export function addUser(username: string, password: string, role: string): DbUserResult {
  if (!db) return { ok: false, error: 'DB bağlantısı yok' };
  if (!username.trim() || !password.trim()) return { ok: false, error: 'Kullanıcı adı ve şifre boş olamaz.' };
  try {
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username.trim(), password, role);
    return { ok: true };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    if (msg.includes('UNIQUE')) return { ok: false, error: 'Bu kullanıcı adı zaten mevcut.' };
    return { ok: false, error: msg };
  }
}

export function updateUser(id: number, username: string, password: string, role: string): DbUserResult {
  if (!db) return { ok: false, error: 'DB bağlantısı yok' };
  if (!username.trim() || !password.trim()) return { ok: false, error: 'Kullanıcı adı ve şifre boş olamaz.' };
  try {
    const info = db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ? AND is_deleted = 0')
      .run(username.trim(), password, role, id);
    if ((info as { changes: number }).changes === 0) return { ok: false, error: 'Kullanıcı bulunamadı.' };
    return { ok: true };
  } catch (err: unknown) {
    const msg = (err as Error).message;
    if (msg.includes('UNIQUE')) return { ok: false, error: 'Bu kullanıcı adı zaten mevcut.' };
    return { ok: false, error: msg };
  }
}

export function deleteUser(id: number): DbUserResult {
  if (!db) return { ok: false, error: 'DB bağlantısı yok' };
  try {
    const user = db.prepare('SELECT role FROM users WHERE id = ? AND is_deleted = 0').get(id) as UserRow | undefined;
    if (!user) return { ok: false, error: 'Kullanıcı bulunamadı.' };
    if (user.role === 'admin') {
      const cnt = (db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND is_deleted = 0").get() as { cnt: number }).cnt;
      if (cnt <= 1) return { ok: false, error: 'Son yönetici hesabı silinemez.' };
    }
    db.prepare('UPDATE users SET is_deleted = 1 WHERE id = ?').run(id);
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message };
  }
}

// ── AKTİVİTE LOGLARI ─────────────────────────

export function addActivityLog(userId: number, username: string, actionType: string, description: string, details?: string | null): boolean {
  if (!db) return false;
  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts  = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
                pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    db.prepare('INSERT INTO activity_logs (user_id, username, action_type, description, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, username, actionType, description, details ?? null, ts);
    return true;
  } catch (err: unknown) {
    console.error('[DB] addActivityLog hatası:', (err as Error).message);
    return false;
  }
}

export function getActivityLogs(): DbActivityLog[] {
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT id, user_id, username, action_type, description, details, timestamp FROM activity_logs WHERE is_deleted = 0 ORDER BY id DESC'
    ).all() as DbActivityLog[];
  } catch (err: unknown) {
    console.error('[DB] getActivityLogs hatası:', (err as Error).message);
    return [];
  }
}

export function deleteActivityLog(id: number): boolean {
  if (!db) return false;
  try {
    db.prepare('UPDATE activity_logs SET is_deleted = 1 WHERE id = ?').run(id);
    return true;
  } catch (err: unknown) {
    console.error('[DB] deleteActivityLog hatası:', (err as Error).message);
    return false;
  }
}

export function clearActivityLogs(): boolean {
  if (!db) return false;
  try {
    db.exec('UPDATE activity_logs SET is_deleted = 1');
    return true;
  } catch (err: unknown) {
    console.error('[DB] clearActivityLogs hatası:', (err as Error).message);
    return false;
  }
}

// ── ENVANTER CRUD ─────────────────────────────

export function getInventory(): DbInventoryItem[] {
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT id, product_name, stock_quantity, min_stock_level, category FROM inventory ORDER BY category, product_name'
    ).all() as DbInventoryItem[];
  } catch (err: unknown) {
    console.error('[DB] getInventory hatası:', (err as Error).message);
    return [];
  }
}

export function upsertInventory(productName: string, stockQty: number, minStockLevel: number, category: string): boolean {
  if (!db) return false;
  try {
    db.prepare(
      'INSERT INTO inventory (product_name, stock_quantity, min_stock_level, category) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(product_name) DO UPDATE SET stock_quantity = ?, min_stock_level = ?, category = ?'
    ).run(productName, stockQty, minStockLevel, category, stockQty, minStockLevel, category);
    return true;
  } catch (err: unknown) {
    console.error('[DB] upsertInventory hatası:', (err as Error).message);
    return false;
  }
}

export function deductStock(items: { name: string; qty: number }[]): DeductStockResult {
  if (!db) return { ok: false, depleted: [] };
  try {
    const depleted: string[] = [];
    const txn = db.transaction((rows: { name: string; qty: number }[]) => {
      for (const row of rows) {
        const inv = db!.prepare('SELECT stock_quantity FROM inventory WHERE product_name = ?').get(row.name) as { stock_quantity: number } | undefined;
        if (!inv) continue;
        if (inv.stock_quantity < row.qty) {
          // Deduct whatever is left (down to 0)
          db!.prepare('UPDATE inventory SET stock_quantity = 0 WHERE product_name = ?').run(row.name);
          depleted.push(row.name);
        } else {
          db!.prepare('UPDATE inventory SET stock_quantity = stock_quantity - ? WHERE product_name = ?').run(row.qty, row.name);
          // Check if now depleted
          const after = db!.prepare('SELECT stock_quantity FROM inventory WHERE product_name = ?').get(row.name) as { stock_quantity: number };
          if (after && after.stock_quantity <= 0) depleted.push(row.name);
        }
      }
    });
    txn(items);
    return { ok: true, depleted };
  } catch (err: unknown) {
    console.error('[DB] deductStock hatası:', (err as Error).message);
    return { ok: false, depleted: [] };
  }
}

export function addStock(name: string, qty: number, category: string): boolean {
  if (!db) return false;
  try {
    db.prepare(
      'INSERT INTO inventory (product_name, stock_quantity, min_stock_level, category) VALUES (?, ?, 5, ?) ' +
      'ON CONFLICT(product_name) DO UPDATE SET stock_quantity = inventory.stock_quantity + excluded.stock_quantity'
    ).run(name, qty, category);
    return true;
  } catch (err: unknown) {
    console.error('[DB] addStock hatası:', (err as Error).message);
    return false;
  }
}

export function restoreStock(items: { name: string; qty: number }[]): boolean {
  if (!db) return false;
  try {
    const txn = db.transaction((rows: { name: string; qty: number }[]) => {
      for (const row of rows) {
        db!.prepare('UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE product_name = ?').run(row.qty, row.name);
      }
    });
    txn(items);
    return true;
  } catch (err: unknown) {
    console.error('[DB] restoreStock hatası:', (err as Error).message);
    return false;
  }
}

// ── KAPAT ─────────────────────────────────────

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Kapatıldı.');
  }
}
