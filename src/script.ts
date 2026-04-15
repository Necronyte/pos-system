/* =============================================
   KAHVE POS — script.ts
   Veri katmanı: SQLite (window.posDB via IPC)
   UI katmanı  : localStorage'sız, tamamen DB'den
   ============================================= */

// ── Global type augmentations (non-module script) ────────────────────

type UserRole     = 'admin' | 'staff';
type DiscountType = 'pct' | 'fixed';
type ModalType    = 'info' | 'warning' | 'error' | 'success';
type ConfirmStyle = 'primary' | 'danger';

interface Extra {
  id:    string;
  name:  string;
  price: number;
}

interface Product {
  id:     number | string;
  name:   string;
  price:  number;
  cat:    string;
  icon:   string;
  desc:   string;
  badge?: string;
}

interface OrderEntry {
  product:     Product;
  extras:      Extra[];
  sentQty:     number;
  pendingQty:  number;
  stockedQty?: number; // how many of sentQty actually came from tracked stock at send time
}

interface SaleItem {
  name:      string;
  icon:      string;
  qty:       number;
  unitPrice: number;
  lineTotal: number;
  extras:    string[];
}

interface SaleRecord {
  id:             string;
  datetime:       string;
  tableId?:       string;
  tableName?:     string;
  subtotal:       number;
  tax:            number;
  discountAmount: number;
  total:          number;
  paymentType:    string;
  cashAmount:     number;
  cardAmount:     number;
  items:          SaleItem[];
}

interface PaySelection {
  orderIdx: number;
  maxQty:   number;
  payQty:   number;
}

interface Zone {
  id:     string;
  label:  string;
  count:  number;
  gridId: string;
}

interface User {
  username: string;
  password: string;
}

interface StaffUser {
  id:       number;
  username: string;
  password: string;
  role:     'admin' | 'staff';
}

interface UserResult {
  ok:     boolean;
  error?: string;
}

interface TransferTarget {
  tid:   string;
  label: string;
  busy:  boolean;
}

interface TableAction {
  label:    string;
  disabled: boolean;
  fn:       () => void;
}

interface ExportResult {
  ok:        boolean;
  reason?:   string;
  filePath?: string;
}

interface ActivityLog {
  id:          number;
  user_id:     number;
  username:    string;
  details:     string | null;
  action_type: string;
  description: string;
  timestamp:   string;
}

type ActionType =
  | 'auth_login'
  | 'auth_logout'
  | 'order_payment'
  | 'order_discounted_payment'
  | 'order_kitchen'
  | 'order_receipt'
  | 'order_clear'
  | 'staff_add'
  | 'staff_update'
  | 'staff_delete';

interface InventoryItem {
  id:              number;
  product_name:    string;
  stock_quantity:  number;
  min_stock_level: number;
  category:        string;
}

interface DeductStockResult {
  ok:       boolean;
  depleted: string[];
}

interface PosDB {
  getAllOrders:      ()                                             => Promise<SaleRecord[]>;
  getVisibleOrders: ()                                             => Promise<SaleRecord[]>;
  hideOrder:        (id: string)                                   => Promise<boolean>;
  saveOrder:        (sale: SaleRecord)                             => Promise<boolean>;
  clearAllOrders:   ()                                             => Promise<boolean>;
  exportCSV:        (csv: string)                                  => Promise<ExportResult>;
  exportExcel:      (html: string)                                 => Promise<ExportResult>;
  getUsers:         ()                                             => Promise<StaffUser[]>;
  addUser:          (u: string, p: string, r: string)              => Promise<UserResult>;
  updateUser:       (id: number, u: string, p: string, r: string)  => Promise<UserResult>;
  deleteUser:       (id: number)                                   => Promise<UserResult>;
  addActivityLog:   (userId: number, username: string, actionType: string, description: string, details?: string | null) => Promise<boolean>;
  getActivityLogs:  ()                                             => Promise<ActivityLog[]>;
  deleteActivityLog:(id: number)                                   => Promise<boolean>;
  clearActivityLogs:()                                             => Promise<boolean>;
  getInventory:     ()                                             => Promise<InventoryItem[]>;
  upsertInventory:  (name: string, qty: number, min: number, cat: string) => Promise<boolean>;
  deductStock:      (items: { name: string; qty: number }[])       => Promise<DeductStockResult>;
  restoreStock:     (items: { name: string; qty: number }[])       => Promise<boolean>;
  addStock:         (name: string, qty: number, cat: string)       => Promise<boolean>;
}

interface ElectronAPI {
  toggleFullscreen: () => void;
  quitApp:          () => void;
  createShortcut:   () => Promise<{ ok: boolean; msg?: string }>;
  focusWindow:      () => void;
  platform:         string;
  minimizeWindow:   () => void;
  maximizeWindow:   () => void;
  closeWindow:      () => void;
  setCurrentUser:   (username: string) => void;
  onMaximizeChange: (cb: (isMaximized: boolean) => void) => void;
}

// Augment the global Window interface (valid in a non-module script file)
interface Window {
  posDB:       PosDB;
  electronAPI: ElectronAPI;
}

// Chart.js loaded via CDN
declare var Chart: any;

// ── ANALİTİK TÜRLER ───────────────────────────

type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'alltime';

interface TimePoint {
  label:   string;
  revenue: number;
  orders:  number;
}

interface TopSeller {
  name:    string;
  icon:    string;
  qty:     number;
  revenue: number;
}

interface AnalyticsResult {
  timePoints:    TimePoint[];
  topSellers:    TopSeller[];
  lowPerformers: TopSeller[];
  totalRevenue:  number;
  cashRevenue:   number;
  cardRevenue:   number;
  totalOrders:   number;
  avgOrderValue: number;
}

// ── MENU VERİSİ ───────────────────────────────

const MENU: Product[] = [
  // SICAK İÇECEKLER
  { id: 1,  name: 'Espresso',               price: 70,  cat: 'hot',     icon: '☕', desc: 'Yoğun ve güçlü tek shot' },
  { id: 2,  name: 'Çift Espresso',          price: 90,  cat: 'hot',     icon: '☕', desc: 'İki shot, tam yoğunluk' },
  { id: 3,  name: 'Americano',              price: 85,  cat: 'hot',     icon: '🫖', desc: 'Espresso ile sıcak su' },
  { id: 4,  name: 'Cappuccino',             price: 110, cat: 'hot',     icon: '☕', desc: 'Espresso, köpüklü buharlanmış süt' },
  { id: 5,  name: 'Latte',                  price: 110, cat: 'hot',     icon: '🥛', desc: 'Espresso ile kremalı süt' },
  { id: 6,  name: 'Flat White',             price: 115, cat: 'hot',     icon: '☕', desc: 'İpeksi mikro köpüklü süt' },
  { id: 7,  name: 'Macchiato',              price: 95,  cat: 'hot',     icon: '☕', desc: 'Espresso üzerine az süt' },
  { id: 8,  name: 'Mocha',                  price: 120, cat: 'hot',     icon: '🍫', desc: 'Espresso, çikolata ve süt' },
  { id: 9,  name: 'Filtre Kahve',           price: 80,  cat: 'hot',     icon: '☕', desc: 'Yavaş demlenmiş damla kahve' },
  // ÖZEL İÇECEKLER
  { id: 10, name: 'Beyaz Çikolatalı Mocha', price: 130, cat: 'special', icon: '🤍', desc: 'Beyaz çikolata enfezliği',          badge: '★' },
  { id: 11, name: 'Karamel Macchiato',      price: 130, cat: 'special', icon: '🍮', desc: 'Vanilyalı, karamelli espresso',      badge: '★' },
  { id: 12, name: 'Affogato',               price: 140, cat: 'special', icon: '🍨', desc: 'Vanilyalı dondurma üzerine espresso',badge: '★' },
  // SOĞUK İÇECEKLER
  { id: 13, name: 'Cold Brew',              price: 120, cat: 'cold',    icon: '🧊', desc: '12 saat soğuk demleme' },
  { id: 14, name: 'Soğuk Americano',        price: 95,  cat: 'cold',    icon: '🥤', desc: 'Buz üzerine espresso ve su' },
  { id: 15, name: 'Soğuk Latte',            price: 120, cat: 'cold',    icon: '🥛', desc: 'Espresso, süt ve buz' },
  { id: 16, name: 'Soğuk Mocha',            price: 130, cat: 'cold',    icon: '🍫', desc: 'Çikolatalı espresso buz üzerinde' },
  { id: 17, name: 'Soğuk Karamel Latte',    price: 135, cat: 'cold',    icon: '🍮', desc: 'Karamelli latte buz üzerinde' },
  // TATLILAR
  { id: 18, name: 'Cheesecake',             price: 150, cat: 'dessert', icon: '🍰', desc: 'Klasik New York usulü' },
  { id: 19, name: 'Çikolatalı Kek',         price: 140, cat: 'dessert', icon: '🎂', desc: 'Zengin bitter çikolatalı katmanlar' },
  { id: 20, name: 'Brownie',                price: 120, cat: 'dessert', icon: '🍫', desc: 'Cevizli fudgy brownie' },
  { id: 21, name: 'Brownie Dondurmalı',     price: 160, cat: 'dessert', icon: '🍨', desc: 'Sıcak brownie, vanilyalı top',       badge: '★' },
  { id: 22, name: 'Tiramisu',               price: 155, cat: 'dessert', icon: '🍮', desc: 'Espressolu klasik İtalyan tatlısı' },
  { id: 23, name: 'San Sebastian',          price: 165, cat: 'dessert', icon: '🍰', desc: 'Yanık Bask usulü cheesecake',        badge: '★' },
  { id: 24, name: 'Havuçlu Kek',            price: 135, cat: 'dessert', icon: '🥕', desc: 'Baharatlı kek, krem peynirli' },
  { id: 25, name: 'Red Velvet',             price: 150, cat: 'dessert', icon: '🎂', desc: 'Kadifemsi katmanlar, krem peynir' },
  { id: 26, name: 'Elmalı Turta',           price: 130, cat: 'dessert', icon: '🥧', desc: 'Tarçınlı sıcak elma dolgulu' },
  { id: 27, name: 'Kruvasan',               price: 90,  cat: 'dessert', icon: '🥐', desc: 'Tereyağlı Fransız usulü' },
  { id: 28, name: 'Çikolatalı Kruvasan',    price: 110, cat: 'dessert', icon: '🥐', desc: 'Bitter çikolata dolgulu kruvasan' },
  { id: 29, name: 'Bademli Kruvasan',       price: 115, cat: 'dessert', icon: '🥐', desc: 'Frangipane ve kavrulmuş badem' },
  { id: 30, name: 'Kurabiye',               price: 70,  cat: 'dessert', icon: '🍪', desc: 'Klasik tereyağlı kurabiye' },
  { id: 31, name: 'Çikolatalı Kurabiye',    price: 80,  cat: 'dessert', icon: '🍪', desc: 'Bol çikolata parçacıklı' },
  { id: 32, name: 'Muffin',                 price: 90,  cat: 'dessert', icon: '🧁', desc: 'Kabarık vanilyalı muffin' },
  { id: 33, name: 'Yaban Mersinli Muffin',  price: 95,  cat: 'dessert', icon: '🧁', desc: 'Taze yaban mersini dolgulu' },
  // BAĞIMSIZ EKSTRALAR (tek başına sipariş edilebilir)
  { id: 'x1', name: 'Ekstra Shot',     price: 20,  cat: 'addon', icon: '☕', desc: 'Tek başına ekstra espresso shot' },
  { id: 'x2', name: 'Yulaf Sütü',     price: 25,  cat: 'addon', icon: '🥛', desc: 'Bitkisel süt değişimi' },
  { id: 'x3', name: 'Badem Sütü',     price: 25,  cat: 'addon', icon: '🥛', desc: 'Badem bazlı süt' },
  { id: 'x4', name: 'Vanilya Şurubu', price: 15,  cat: 'addon', icon: '🍯', desc: 'Tatlı vanilya aroması' },
  { id: 'x5', name: 'Karamel Şurubu', price: 15,  cat: 'addon', icon: '🍯', desc: 'Karamel aroması' },
  { id: 'x6', name: 'Fındık Şurubu',  price: 15,  cat: 'addon', icon: '🍯', desc: 'Fındık aroması' },
  { id: 'x7', name: 'Dondurma',       price: 40,  cat: 'addon', icon: '🍨', desc: 'Vanilyalı top dondurma' },
  { id: 'x8', name: 'Çikolata Sosu',  price: 20,  cat: 'addon', icon: '🍫', desc: 'Zengin çikolata sosu' },
  { id: 'x9', name: 'Krem Şanti',     price: 20,  cat: 'addon', icon: '🍦', desc: 'Taze krem şanti' },
];

const EXTRAS: Extra[] = [
  { id: 'e1', name: 'Ekstra Shot',     price: 20 },
  { id: 'e2', name: 'Yulaf Sütü',     price: 25 },
  { id: 'e3', name: 'Badem Sütü',     price: 25 },
  { id: 'e4', name: 'Vanilya Şurubu', price: 15 },
  { id: 'e5', name: 'Karamel Şurubu', price: 15 },
  { id: 'e6', name: 'Fındık Şurubu',  price: 15 },
];

const DESSERT_EXTRAS: Extra[] = [
  { id: 'd1', name: 'Dondurma',      price: 40 },
  { id: 'd2', name: 'Çikolata Sosu', price: 20 },
  { id: 'd3', name: 'Karamel Sosu',  price: 20 },
  { id: 'd4', name: 'Krem Şanti',    price: 20 },
  { id: 'd5', name: 'Fındık Kırığı', price: 25 },
  { id: 'd6', name: 'Antep Fıstığı', price: 30 },
];

const TAX_RATE = 0.08;

// ── STATE ─────────────────────────────────────

let order:               OrderEntry[] = [];
let activeExtras:        string[]     = [];
let activeDessertExtras: string[]     = [];
let activeCategory:      string       = 'all';
let salesHistory:        SaleRecord[] = [];
let analyticsHistory:    SaleRecord[] = [];
let historyQuery:        string       = '';
let expandedSaleId:      string | null = null;
let lastProductCat:      string       = '';

// ── MASA SİSTEMİ ──────────────────────────────

const tableOrders: Record<string, OrderEntry[]>  = {};
let activeTableId:   string | null = null;
let activeTableName: string        = '';

const ZONES: Zone[] = [
  { id: 'ic',  label: 'İç Salon',  count: 10, gridId: 'tableGridInner' },
  { id: 'dis', label: 'Dış Bahçe', count: 10, gridId: 'tableGridOuter' },
];

const tableLastUser: Record<string, string>  = {};
const tableReservations: Record<string, boolean> = {};
const LS_RESERVATIONS = 'kahve_pos_reservations';

function loadReservations(): void {
  try {
    const r = localStorage.getItem(LS_RESERVATIONS);
    if (r) Object.assign(tableReservations, JSON.parse(r) as Record<string, boolean>);
  } catch (e) { /* ignore */ }
}

function saveReservations(): void {
  try { localStorage.setItem(LS_RESERVATIONS, JSON.stringify(tableReservations)); } catch (e) { /* ignore */ }
}

let _openMenuTid: string | null = null;

let receiptMode: 'payment' | 'preview' = 'payment';

// ── ANALİTİK STATE ────────────────────────────

let analyticsPeriod: AnalyticsPeriod = 'daily';
let analyticsMonth:  string | null   = null; // 'YYYY-MM' veya null
let analyticsDay:    string | null   = null; // 'YYYY-MM-DD' veya null

// ── ÜRÜN SATIŞ STATE ─────────────────────────
let productSalesHistory: SaleRecord[] = [];
let productSalesPeriod:  string       = 'daily';
let productSalesMonth:   string | null = null; // 'YYYY-MM' — independent from Analytics
let productSalesDay:     string | null = null; // 'YYYY-MM-DD' — independent from Analytics
let productSalesSearchQ: string       = '';
let productSalesSortAsc: boolean      = false;
let analyticsRelativeN:       number | null = null; // e.g. 3
let analyticsRelativeUnit:    string | null = null; // 'gün' | 'hafta' | 'ay' | 'yıl'
let productSalesRelativeN:    number | null = null;
let productSalesRelativeUnit: string | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let revenueChartInst:    any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let revenueYAxisInst:    any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let topSellersChartInst: any = null;

// ── PERSONEL STATE ────────────────────────────

let staffList:        StaffUser[] = [];
let staffSearchQuery: string      = '';
let staffEditingId:   number | null = null;

// ── KAYIT STATE ───────────────────────────────

let activityLogs:    ActivityLog[] = [];
let logsSearchQuery: string        = '';

// ── ENVANTER STATE ────────────────────────────

let inventoryCache:        InventoryItem[] = [];
let invEditingProduct:     string          = '';
let invSearchQuery:        string          = '';
let invModalMode:          'add' | 'edit'  = 'edit';

// ── GİZLİ SİPARİŞ YÖNETİMİ (DB tabanlı soft-delete) ──────────────────
// Gizleme artık localStorage'da değil, veritabanındaki visible_in_history sütunuyla yönetilir.

// ── DB YARDIMCI ────────────────────────────────

const DB = new Proxy({} as PosDB, {
  get(_t: PosDB, method: string | symbol): unknown {
    const target = window.posDB;
    const key = String(method);
    if (target && typeof (target as unknown as Record<string, unknown>)[key] === 'function') {
      return (target as unknown as Record<string, unknown>)[key];
    }
    console.error('[POS] window.posDB.' + key + ' bulunamadı — preload yüklendi mi?');
    return async (): Promise<boolean | unknown[]> => {
      return key === 'saveOrder' ? false : [];
    };
  }
});

// ── ID ÜRETECI ────────────────────────────────

function generateOrderId(): string {
  const ts   = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.floor(Math.random() * 900 + 100);
  return 'KHV-' + ts + rand;
}

// ── TEMA YÖNETİMİ ─────────────────────────────

function initExtrasToggle(): void {
  const section = document.getElementById('extrasSection');
  const btn     = document.getElementById('extrasToggleBtn');
  if (!section || !btn) return;

  const saved = localStorage.getItem('kahve_pos_extras_open');
  if (saved === 'true') {
    section.classList.remove('collapsed');
  } else {
    section.classList.add('collapsed');
  }

  btn.addEventListener('click', () => {
    const isCollapsed = section.classList.toggle('collapsed');
    localStorage.setItem('kahve_pos_extras_open', String(!isCollapsed));
  });
}

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme);
  const isLight = theme === 'light';
  const emoji   = isLight ? '☀️' : '🌙';
  ['themeToggleIcon','themeToggleIconTable','themeToggleIconSelection','themeToggleIconAnalytics','themeToggleIconStaff','themeToggleIconLogs','themeToggleIconProductSales','themeToggleIconInventory'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = emoji;
  });
  try { localStorage.setItem('kahve_pos_theme', theme); } catch(e) { /* ignore */ }
}

function loadTheme(): void {
  let saved = 'dark';
  try { saved = localStorage.getItem('kahve_pos_theme') || 'dark'; } catch(e) { /* ignore */ }
  applyTheme(saved);
}

function toggleTheme(): void {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ── RENDER: ÜRÜNLER ───────────────────────────

function renderProducts(): void {
  const grid = document.getElementById('productsGrid')!;
  grid.innerHTML = '';
  const cats = activeCategory === 'all'
    ? ['hot', 'cold', 'special', 'dessert', 'addon']
    : [activeCategory];
  const catLabels: Record<string, string> = {
    hot:     'Sıcak İçecekler',
    cold:    'Soğuk İçecekler',
    special: 'Özel İçecekler',
    dessert: 'Tatlılar ve Pastalar',
    addon:   'Bağımsız Ekstralar',
  };

  cats.forEach(cat => {
    const items = MENU.filter(m => m.cat === cat);
    if (!items.length) return;

    const label = document.createElement('div');
    label.className   = 'category-label';
    label.textContent = catLabels[cat] ?? cat;
    grid.appendChild(label);

    items.forEach(product => {
      const card = document.createElement('div');
      card.className  = 'product-card';
      card.dataset.id = String(product.id);
      const inOrder = order.filter(o => o.product.id === product.id);
      const qty = inOrder.reduce((s, o) => s + (o.sentQty||0) + (o.pendingQty||0), 0);
      const invItem = inventoryCache.find(iv => iv.product_name.toLowerCase() === product.name.toLowerCase());
      const stockLabel = invItem === undefined ? '' :
        invItem.stock_quantity > 0
          ? `<div class="product-stok-label">Stok: ${invItem.stock_quantity}</div>`
          : `<div class="product-stok-yok">Stok Yok</div>`;
      card.innerHTML = `
        <div class="product-icon">${product.icon}</div>
        <div class="product-name">${product.name}</div>
        <div class="product-desc">${product.desc}</div>
        <div class="product-price">&#8378;${product.price}</div>
        ${product.badge ? `<div class="product-badge">${product.badge}</div>` : ''}
        ${qty > 0 ? `<div class="product-qty-badge">${qty}</div>` : ''}
        ${stockLabel}
      `;
      card.addEventListener('click', () => addToOrder(product, card));
      grid.appendChild(card);
    });
  });
}

// ── RENDER: SİPARİŞ ───────────────────────────

function renderOrder(): void {
  const container = document.getElementById('orderItems')!;
  if (order.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="display:flex">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="1.5" opacity="0.3"/>
          <path d="M14 30 Q17 18 24 22 Q31 26 34 18" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.4"/>
        </svg>
        <p>Henüz ürün yok</p>
        <span>Eklemek için bir ürüne dokunun</span>
      </div>`;
    updateTotals();
    return;
  }

  container.innerHTML = '';
  order.forEach((entry, idx) => {
    const et          = entry.extras.reduce((s, e) => s + e.price, 0);
    const unitPrice   = entry.product.price + et;
    const totalQty    = (entry.sentQty || 0) + (entry.pendingQty || 0);
    const linePrice   = unitPrice * totalQty;
    const extrasNames = entry.extras.map(e => e.name).join(', ');
    const hasSent     = (entry.sentQty || 0) > 0;
    const hasPending  = (entry.pendingQty || 0) > 0;

    const row = document.createElement('div');
    row.className = 'order-item';

    let qtyDisplay: string;
    if (hasSent && hasPending) {
      qtyDisplay = '<span class="qty-sent">' + entry.sentQty + '</span>' +
                   '<span class="qty-plus-sep">+</span>' +
                   '<span class="qty-pending">' + entry.pendingQty + '</span>';
    } else {
      qtyDisplay = '<span class="qty-value">' + totalQty + '</span>';
    }

    const minusDisabled = (!hasPending && hasSent && userRole !== 'admin')
      ? 'disabled title="Gönderildi — silinemez"'
      : 'title="Azalt"';

    row.innerHTML =
      '<div class="item-info">' +
        '<div class="item-name">' + entry.product.icon + ' ' + entry.product.name +
          (hasSent ? '<span class="item-sent-badge">✓</span>' : '') + '</div>' +
        (extrasNames ? '<div class="item-extras">+ ' + extrasNames + '</div>' : '') +
        '<div class="item-price">&#8378;' + unitPrice + ' x ' + totalQty + '</div>' +
      '</div>' +
      '<div class="item-controls">' +
        '<button class="qty-btn minus" ' + minusDisabled + '>&#8722;</button>' +
        qtyDisplay +
        '<button class="qty-btn plus" title="Artır">+</button>' +
      '</div>' +
      '<div class="item-total">&#8378;' + linePrice + '</div>';

    if (hasPending || userRole === 'admin') {
      row.querySelector('.minus')!.addEventListener('click', () => changeQty(idx, -1));
    }
    row.querySelector('.plus')!.addEventListener('click', () => changeQty(idx, +1));
    container.appendChild(row);
  });
  updateTotals();
}

function renderExtras(): void {
  const grid = document.getElementById('extrasGrid')!;
  grid.innerHTML = '';

  const coffeeLabel = document.createElement('div');
  coffeeLabel.className = 'extras-group-label';
  coffeeLabel.textContent = '☕ Kahve Ekstraları';
  grid.appendChild(coffeeLabel);

  EXTRAS.forEach(ex => {
    const btn = document.createElement('button');
    btn.className = 'extra-btn' + (activeExtras.includes(ex.id) ? ' active' : '');
    btn.innerHTML = ex.name + ' <span class="extra-price">+&#8378;' + ex.price + '</span>';
    btn.addEventListener('click', () => {
      if (activeExtras.includes(ex.id)) {
        activeExtras = activeExtras.filter(e => e !== ex.id);
        btn.classList.remove('active');
      } else {
        activeExtras.push(ex.id);
        btn.classList.add('active');
      }
    });
    grid.appendChild(btn);
  });

  const dessertLabel = document.createElement('div');
  dessertLabel.className = 'extras-group-label';
  dessertLabel.textContent = '🍰 Tatlı Ekstraları';
  grid.appendChild(dessertLabel);

  DESSERT_EXTRAS.forEach(ex => {
    const btn = document.createElement('button');
    btn.className = 'extra-btn dessert-extra-btn' + (activeDessertExtras.includes(ex.id) ? ' active' : '');
    btn.innerHTML = ex.name + ' <span class="extra-price">+&#8378;' + ex.price + '</span>';
    btn.addEventListener('click', () => {
      if (activeDessertExtras.includes(ex.id)) {
        activeDessertExtras = activeDessertExtras.filter(e => e !== ex.id);
        btn.classList.remove('active');
      } else {
        activeDessertExtras.push(ex.id);
        btn.classList.add('active');
      }
    });
    grid.appendChild(btn);
  });
}

function updateTotals(): void {
  const subtotal = order.reduce((sum, entry) => {
    const et  = entry.extras.reduce((s, e) => s + e.price, 0);
    const qty = (entry.sentQty || 0) + (entry.pendingQty || 0);
    return sum + (entry.product.price + et) * qty;
  }, 0);
  const tax   = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  document.getElementById('subtotalDisplay')!.textContent = '\u20ba' + subtotal;
  document.getElementById('taxDisplay')!.textContent      = '\u20ba' + tax;
  document.getElementById('totalDisplay')!.textContent    = '\u20ba' + total;
  const hasItems  = order.length > 0;
  const hasUnsent = order.some(e => (e.pendingQty || 0) > 0);
  (document.getElementById('completeBtn') as HTMLButtonElement).disabled = !hasItems;
  const kitchenBtn = document.getElementById('kitchenBtn') as HTMLButtonElement | null;
  const receiptBtn = document.getElementById('receiptPreviewBtn') as HTMLButtonElement | null;
  if (kitchenBtn) kitchenBtn.disabled = !hasUnsent;
  if (receiptBtn) receiptBtn.disabled = !hasItems;
}

// ── RENDER: SATIŞ GEÇMİŞİ ────────────────────

function paymentBadge(sale: SaleRecord): string {
  const type = sale.paymentType || 'cash';
  if (type === 'cash')  return '<span class="payment-badge cash">Nakit</span>';
  if (type === 'card')  return '<span class="payment-badge card">Kart</span>';
  return '<span class="payment-badge split">B\xf6l\xfcnm\xfc\u015f</span>';
}

function renderHistory(highlightId?: string): void {
  const list  = document.getElementById('historyList')!;
  const count = salesHistory.length;

  const totalRevenue = salesHistory.reduce((s, sale) => s + sale.total, 0);
  const todayStr     = new Date().toDateString();
  const todayRev     = salesHistory
    .filter(s => new Date(s.datetime).toDateString() === todayStr)
    .reduce((s, sale) => s + sale.total, 0);

  const totalCash = salesHistory.reduce((s, sale) => {
    if (sale.paymentType === 'cash')  return s + sale.total;
    if (sale.paymentType === 'split') return s + (sale.cashAmount || 0);
    return s;
  }, 0);
  const totalCard = salesHistory.reduce((s, sale) => {
    if (sale.paymentType === 'card')  return s + sale.total;
    if (sale.paymentType === 'split') return s + (sale.cardAmount || 0);
    return s;
  }, 0);

  document.getElementById('historyStats')!.innerHTML =
    '<div class="stat-block"><span class="stat-label">Toplam Sipariş</span><span class="stat-value">' + count + '</span></div>' +
    '<div class="stat-block"><span class="stat-label">Toplam Ciro</span><span class="stat-value">\u20ba' + totalRevenue.toLocaleString('tr-TR') + '</span></div>' +
    '<div class="stat-block"><span class="stat-label">Bugün</span><span class="stat-value">\u20ba' + todayRev.toLocaleString('tr-TR') + '</span></div>' +
    '<div class="stat-block"><span class="stat-label">Nakit</span><span class="stat-value">\u20ba' + totalCash.toLocaleString('tr-TR') + '</span></div>' +
    '<div class="stat-block"><span class="stat-label">Kart</span><span class="stat-value">\u20ba' + totalCard.toLocaleString('tr-TR') + '</span></div>';

  const q = historyQuery.trim().toLowerCase();
  const filtered = q
    ? salesHistory.filter(sale =>
        sale.id.toLowerCase().includes(q) ||
        sale.items.some(it => it.name.toLowerCase().includes(q))
      )
    : salesHistory;

  if (filtered.length === 0) {
    list.innerHTML =
      '<div class="history-empty">' +
      '<svg width="44" height="44" viewBox="0 0 44 44" fill="none">' +
      '<rect x="6" y="6" width="32" height="32" rx="5" stroke="currentColor" stroke-width="1.4" opacity="0.3"/>' +
      '<path d="M13 16h18M13 22h18M13 28h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.4"/>' +
      '</svg>' +
      '<p>' + (q ? 'Eşleşen sipariş bulunamadı' : 'Henüz satış yok') + '</p>' +
      '<span>' + (q ? 'Farklı bir arama terimi deneyin' : 'Tamamlanan siparişler burada görünecek') + '</span>' +
      '</div>';
    return;
  }

  list.innerHTML = '';
  [...filtered].reverse().forEach(sale => {
    const isExpanded = sale.id === expandedSaleId;
    const isNew      = sale.id === highlightId;
    const itemCount  = sale.items.reduce((s, it) => s + it.qty, 0);
    const { date: dateStr, time: timeStr } = parseSaleDate(sale.datetime);

    const detailRows = sale.items.map(it => {
      const extrasText = it.extras && it.extras.length ? it.extras.join(', ') : '';
      return '<div class="sale-detail-item">' +
        '<div class="detail-qty">\xd7' + it.qty + '</div>' +
        '<div class="detail-info">' +
          '<div class="detail-name">' + (it.icon || '\u2615') + ' ' + it.name + '</div>' +
          (extrasText ? '<div class="detail-extras">+ ' + extrasText + '</div>' : '') +
        '</div>' +
        '<div class="detail-price">\u20ba' + it.lineTotal + '</div>' +
        '</div>';
    }).join('');

    const card = document.createElement('div');
    card.className      = 'sale-card' + (isExpanded ? ' expanded' : '') + (isNew ? ' new-sale' : '');
    card.dataset.saleid = sale.id;
    card.innerHTML =
      '<div class="sale-summary">' +
        '<div class="sale-icon">🧾</div>' +
        '<div class="sale-meta">' +
          '<div class="sale-id">' + sale.id + '</div>' +
          '<div class="sale-datetime">' + dateStr + ' \xb7 ' + timeStr + '</div>' +
          '<div class="sale-item-count">' + itemCount + ' ürün &nbsp;' + paymentBadge(sale) + '</div>' +
        '</div>' +
        '<div class="sale-total-col">' +
          '<div class="sale-total-amount">\u20ba' + sale.total + '</div>' +
          '<div class="sale-total-label">' + (sale.discountAmount > 0 ? 'İndirim + KDV dahil' : 'KDV dahil') + '</div>' +
        '</div>' +
        '<svg class="sale-expand-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">' +
          '<path d="M2.5 5l4.5 4.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
      '</div>' +
      '<div class="sale-details">' +
        detailRows +
        '<div class="sale-details-footer">' +
          '<span>Ara Toplam \u20ba' + sale.subtotal + ' \xb7 KDV \u20ba' + sale.tax + '</span>' +
          (sale.discountAmount > 0
            ? '<span class="sale-discount-line">\u2212\u20ba' + sale.discountAmount + ' İndirim</span>'
            : '') +
          '<span>Toplam <strong>\u20ba' + sale.total + '</strong></span>' +
        '</div>' +
      '</div>';

    card.querySelector('.sale-summary')!.addEventListener('click', function() {
      expandedSaleId = isExpanded ? null : sale.id;
      renderHistory();
    });
    list.appendChild(card);
  });
}

// ── SEPET İŞLEMLERİ ───────────────────────────

function addToOrder(product: Product, cardEl: HTMLElement): void {
  const isDessert = product.cat === 'dessert';
  const isAddon   = product.cat === 'addon';
  const selectedExtras: Extra[] = isAddon ? [] : (isDessert
    ? DESSERT_EXTRAS.filter(e => activeDessertExtras.includes(e.id))
    : EXTRAS.filter(e => activeExtras.includes(e.id)));

  const extrasKey = JSON.stringify(selectedExtras.map(e => e.id).sort());
  const existing  = order.find(o =>
    o.product.id === product.id &&
    o.pendingQty > 0 &&
    JSON.stringify(o.extras.map(e => e.id).sort()) === extrasKey
  );
  if (existing) {
    existing.pendingQty += 1;
  } else {
    order.push({ product, extras: selectedExtras.slice(), sentQty: 0, pendingQty: 1 });
  }

  activeExtras        = [];
  activeDessertExtras = [];
  lastProductCat      = product.cat;

  // Non-blocking stock warning: fire once when total order qty crosses the stock boundary
  const invItem = inventoryCache.find(iv => iv.product_name.toLowerCase() === product.name.toLowerCase());
  if (invItem && invItem.stock_quantity > 0) {
    const totalQty = order
      .filter(o => o.product.id === product.id)
      .reduce((s, o) => s + (o.sentQty || 0) + (o.pendingQty || 0), 0);
    if (totalQty === invItem.stock_quantity + 1) {
      const wt = document.createElement('div');
      wt.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#b45309;color:#fff;padding:10px 22px;border-radius:8px;z-index:9999;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:opacity .4s';
      wt.textContent = '⚠️ Dikkat: Stokta sadece ' + invItem.stock_quantity + ' adet ' + product.name + ' görünüyor.';
      document.body.appendChild(wt);
      setTimeout(() => { wt.style.opacity = '0'; setTimeout(() => wt.remove(), 400); }, 3500);
    }
  }

  cardEl.classList.add('added');
  setTimeout(() => cardEl.classList.remove('added'), 400);
  saveTableOrder();
  renderOrder();
  renderProducts();
  renderExtras();
}

function changeQty(idx: number, delta: number): void {
  const entry = order[idx];
  if (delta < 0) {
    if ((entry.pendingQty || 0) > 0) {
      // Pending item — stock was never deducted, remove silently
      entry.pendingQty = Math.max(0, entry.pendingQty - 1);
      if ((entry.pendingQty || 0) === 0 && (entry.sentQty || 0) === 0) order.splice(idx, 1);
      saveTableOrder(); renderOrder(); renderProducts();
    } else if (userRole === 'admin' && (entry.sentQty || 0) > 0) {
      const invItem = inventoryCache.find(iv => iv.product_name === entry.product.name);
      if (invItem !== undefined) {
        // stockedQty tracks how many units genuinely came from the shelf.
        // Units beyond stockedQty are "over-stock" and are removed silently.
        const stockedUnits   = entry.stockedQty ?? entry.sentQty;
        const overStockUnits = (entry.sentQty || 0) - stockedUnits;

        if (overStockUnits > 0) {
          // Over-stock unit — remove silently, no DB change, stockedQty stays the same
          entry.sentQty = Math.max(0, (entry.sentQty || 0) - 1);
          if ((entry.pendingQty || 0) === 0 && (entry.sentQty || 0) === 0) order.splice(idx, 1);
          saveTableOrder(); renderOrder(); renderProducts();
        } else if (stockedUnits > 0) {
          // Stocked unit — offer reversal modal
          showStockReversalModal([{ name: entry.product.name, icon: entry.product.icon, maxQty: 1 }])
            .then(async result => {
              if (result === null) return; // cancelled
              if (result.length > 0) {
                await DB.restoreStock(result);
                inventoryCache = await DB.getInventory() as InventoryItem[];
              }
              entry.sentQty = Math.max(0, (entry.sentQty || 0) - 1);
              if (entry.stockedQty !== undefined) entry.stockedQty = Math.max(0, entry.stockedQty - 1);
              if ((entry.pendingQty || 0) === 0 && (entry.sentQty || 0) === 0) order.splice(idx, 1);
              saveTableOrder(); renderOrder(); renderProducts();
            });
        } else {
          // stockedQty=0 and no over-stock (edge case) — remove silently
          entry.sentQty = Math.max(0, entry.sentQty - 1);
          if ((entry.pendingQty || 0) === 0 && (entry.sentQty || 0) === 0) order.splice(idx, 1);
          saveTableOrder(); renderOrder(); renderProducts();
        }
      } else {
        // Not in inventory — remove silently
        entry.sentQty = Math.max(0, entry.sentQty - 1);
        if ((entry.pendingQty || 0) === 0 && (entry.sentQty || 0) === 0) order.splice(idx, 1);
        saveTableOrder(); renderOrder(); renderProducts();
      }
    }
  } else {
    entry.pendingQty += 1;
    // Non-blocking stock warning when + button crosses the stock boundary
    const invItemP = inventoryCache.find(iv => iv.product_name.toLowerCase() === entry.product.name.toLowerCase());
    if (invItemP && invItemP.stock_quantity > 0) {
      const totalQtyP = order
        .filter(o => o.product.id === entry.product.id)
        .reduce((s, o) => s + (o.sentQty || 0) + (o.pendingQty || 0), 0);
      if (totalQtyP === invItemP.stock_quantity + 1) {
        const wt = document.createElement('div');
        wt.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#b45309;color:#fff;padding:10px 22px;border-radius:8px;z-index:9999;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:opacity .4s';
        wt.textContent = '⚠️ Dikkat: Stokta sadece ' + invItemP.stock_quantity + ' adet ' + entry.product.name + ' görünüyor.';
        document.body.appendChild(wt);
        setTimeout(() => { wt.style.opacity = '0'; setTimeout(() => wt.remove(), 400); }, 3500);
      }
    }
    saveTableOrder(); renderOrder(); renderProducts();
  }
}

function clearOrder(): void {
  order = order.filter(e => (e.sentQty || 0) > 0);
  order.forEach(e => { e.pendingQty = 0; });
  activeExtras        = [];
  activeDessertExtras = [];
  saveTableOrder();
  renderOrder();
  renderProducts();
  renderExtras();
  updateTotals();
}

async function clearOrderAdmin(): Promise<void> {
  const clearTableDesc = activeTableName ? ' ' + activeTableName : '';

  // Build list of sent inventory items the admin can return to stock.
  // maxQty is capped to stockedQty (units that genuinely came from the shelf).
  // Items with no stocked units (all over-stock) are excluded entirely.
  const inventoryItems: StockReversalItem[] = order
    .filter(e => {
      if ((e.sentQty || 0) <= 0) return false;
      const inv = inventoryCache.find(iv => iv.product_name === e.product.name);
      if (!inv) return false;
      const stocked = e.stockedQty ?? (e.sentQty as number);
      return stocked > 0;
    })
    .map(e => {
      const stocked = e.stockedQty ?? (e.sentQty as number);
      return {
        name:        e.product.name,
        icon:        e.product.icon,
        maxQty:      stocked,
        originalQty: e.sentQty as number,
      };
    });

  let restorations: { name: string; qty: number }[];
  if (inventoryItems.length > 0) {
    const result = await showStockReversalModal(inventoryItems);
    if (result === null) return; // admin cancelled
    restorations = result;
  } else {
    const ok = await showConfirm('Sepeti Temizle', 'Bu ürünler mutfağa gönderilmiş.\nSilmek istediğinize emin misiniz?', 'Evet, Sil', 'İptal', 'danger');
    if (!ok) return;
    restorations = [];
  }

  if (restorations.length > 0) {
    try {
      await DB.restoreStock(restorations);
      inventoryCache = await DB.getInventory() as InventoryItem[];
    } catch (err) {
      console.error('[POS] Stok geri yükleme hatası:', err);
    }
  }

  logActivity('order_clear', activeUser + clearTableDesc + ' siparişini (mutfak dahil) zorla temizledi');
  order               = [];
  activeExtras        = [];
  activeDessertExtras = [];
  saveTableOrder();
  renderOrder();
  renderProducts();
  renderExtras();
  updateTotals();
}

// ── CUSTOM MODAL UTILITIES ────────────────────

const CMODAL_ICONS: Record<ModalType, string> = {
  info:    'i',
  warning: '!',
  error:   '✕',
  success: '✓',
};

function showAlert(title: string, message: string, type: ModalType = 'info'): Promise<void> {
  return new Promise<void>(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'cmodal-backdrop';
    backdrop.innerHTML =
      '<div class="cmodal-box" role="dialog" aria-modal="true">' +
        '<div class="cmodal-header">' +
          '<span class="cmodal-icon cmodal-icon--' + type + '">' + (CMODAL_ICONS[type] || 'i') + '</span>' +
          '<span class="cmodal-title">' + title + '</span>' +
        '</div>' +
        '<div class="cmodal-body">' + message + '</div>' +
        '<div class="cmodal-actions">' +
          '<button class="cmodal-btn cmodal-btn-primary" data-action="ok">Tamam</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    const okBtn = backdrop.querySelector('[data-action="ok"]') as HTMLButtonElement;
    okBtn.focus();
    okBtn.addEventListener('click', () => { backdrop.remove(); resolve(); });
  });
}

function showConfirm(
  title:        string,
  message:      string,
  confirmText:  string       = 'Tamam',
  cancelText:   string       = 'İptal',
  confirmStyle: ConfirmStyle = 'primary',
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'cmodal-backdrop';
    backdrop.innerHTML =
      '<div class="cmodal-box" role="dialog" aria-modal="true">' +
        '<div class="cmodal-header">' +
          '<span class="cmodal-icon cmodal-icon--warning">!</span>' +
          '<span class="cmodal-title">' + title + '</span>' +
        '</div>' +
        '<div class="cmodal-body">' + message + '</div>' +
        '<div class="cmodal-actions">' +
          '<button class="cmodal-btn cmodal-btn-cancel"  data-action="cancel">'  + cancelText  + '</button>' +
          '<button class="cmodal-btn cmodal-btn-' + confirmStyle + '" data-action="confirm">' + confirmText + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    (backdrop.querySelector('[data-action="confirm"]') as HTMLButtonElement).focus();
    (backdrop.querySelector('[data-action="confirm"]') as HTMLButtonElement).addEventListener('click', () => { backdrop.remove(); resolve(true);  });
    (backdrop.querySelector('[data-action="cancel"]')  as HTMLButtonElement).addEventListener('click', () => { backdrop.remove(); resolve(false); });
  });
}

// ── STOK İADESİ MODALİ ───────────────────────

interface StockReversalItem { name: string; icon: string; maxQty: number; originalQty?: number; }

function showStockReversalModal(items: StockReversalItem[]): Promise<{ name: string; qty: number }[] | null> {
  return new Promise(resolve => {
    // isOne: single-unit removal via '-' button (1 item, maxQty always 1)
    // All trash-can calls (single or multiple items, any maxQty > 1) use the stepper view.
    const isOne = items.length === 1 && items[0].maxQty === 1;
    const title = 'Stok İadesi';

    let bodyHTML: string;
    if (isOne) {
      // Simple yes/no label for single-unit '-' button removal
      bodyHTML =
        '<div class="srmodal-s1-label">' +
          '<span class="srmodal-item-icon">' + items[0].icon + '</span>' +
          '<span><strong>' + items[0].name + '</strong> stoka geri eklensin mi?</span>' +
        '</div>';
    } else {
      // Detailed stepper view for all trash-can cases — counters start at 0
      bodyHTML =
        '<p class="srmodal-hint">Stokta bulunan ' + items.length + ' adet ürün için iade seçeneklerini belirleyin.</p>' +
        '<p class="srmodal-notice">Girilen adetler stoka geri iade edilecek, girilmeyen miktarlar zayi (fire) kabul edilecektir.</p>' +
        '<div class="srmodal-list">' +
        items.map((item, i) => {
          const hasDiscrep = item.originalQty !== undefined && item.originalQty > item.maxQty;
          const totalLabel = hasDiscrep ? (item.originalQty + 'x') : (item.maxQty + 'x');
          const discrepNote = hasDiscrep
            ? '<span class="srmodal-cap-note">(Stoktan düşen: ' + item.maxQty + ')</span>'
            : '';
          return '<div class="srmodal-row">' +
            '<div class="srmodal-item-info">' +
              '<span class="srmodal-item-icon">' + item.icon + '</span>' +
              '<span class="srmodal-item-name">' + item.name + '</span>' +
              '<span class="srmodal-item-total">' + totalLabel + '</span>' +
              discrepNote +
            '</div>' +
            '<div class="srmodal-qty-ctrl">' +
              '<button class="srmodal-qty-btn srmodal-dec" data-idx="' + i + '" type="button">−</button>' +
              '<input class="srmodal-qty-input" type="number" min="0" max="' + item.maxQty + '" value="0" data-idx="' + i + '" />' +
              '<button class="srmodal-qty-btn srmodal-inc" data-idx="' + i + '" type="button">+</button>' +
              '<span class="srmodal-max-label">/ ' + item.maxQty + '</span>' +
            '</div>' +
          '</div>';
        }).join('') +
        '</div>';
    }

    // '-' button: 3-button explicit choice. Trash can: 2-button (waste is implicit at qty=0).
    const actionsHTML = isOne
      ? '<button class="cmodal-btn cmodal-btn-cancel"  data-action="cancel">Vazgeç</button>' +
        '<button class="cmodal-btn cmodal-btn-cancel"  data-action="waste">Hayır — Zayi</button>' +
        '<button class="cmodal-btn cmodal-btn-primary" data-action="restore">Evet — Stoka Ekle</button>'
      : '<button class="cmodal-btn cmodal-btn-cancel"  data-action="cancel">Vazgeç</button>' +
        '<button class="cmodal-btn cmodal-btn-select-all" data-action="select-all">Hepsini Seç</button>' +
        '<button class="cmodal-btn cmodal-btn-primary" data-action="restore">Onayla ve Sil</button>';

    const backdrop = document.createElement('div');
    backdrop.className = 'cmodal-backdrop';
    backdrop.innerHTML =
      '<div class="cmodal-box srmodal-box" role="dialog" aria-modal="true">' +
        '<div class="cmodal-header">' +
          '<span class="cmodal-icon cmodal-icon--success">↩</span>' +
          '<span class="cmodal-title">' + title + '</span>' +
        '</div>' +
        '<div class="srmodal-body">' + bodyHTML + '</div>' +
        '<div class="cmodal-actions">' + actionsHTML + '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    if (!isOne) {
      const toggleBtn = backdrop.querySelector<HTMLButtonElement>('[data-action="select-all"]')!;
      const allInputs = () => Array.from(backdrop.querySelectorAll<HTMLInputElement>('.srmodal-qty-input'));
      const allAtMax  = () => allInputs().every(inp => Number(inp.value) >= Number(inp.max));

      const syncToggleBtn = () => {
        toggleBtn.textContent = allAtMax() ? 'Hepsini Kaldır' : 'Hepsini Seç';
      };

      backdrop.querySelectorAll<HTMLButtonElement>('.srmodal-dec').forEach(btn => {
        btn.addEventListener('click', () => {
          const inp = backdrop.querySelector<HTMLInputElement>('.srmodal-qty-input[data-idx="' + btn.dataset.idx + '"]')!;
          inp.value = String(Math.max(0, Number(inp.value) - 1));
          syncToggleBtn();
        });
      });
      backdrop.querySelectorAll<HTMLButtonElement>('.srmodal-inc').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.idx);
          const inp = backdrop.querySelector<HTMLInputElement>('.srmodal-qty-input[data-idx="' + idx + '"]')!;
          inp.value = String(Math.min(items[idx].maxQty, Number(inp.value) + 1));
          syncToggleBtn();
        });
      });
      backdrop.querySelectorAll<HTMLInputElement>('.srmodal-qty-input').forEach(inp => {
        inp.addEventListener('change', () => {
          const idx = Number(inp.dataset.idx);
          const v = parseInt(inp.value, 10);
          if (isNaN(v) || v < 0) inp.value = '0';
          else if (v > items[idx].maxQty) inp.value = String(items[idx].maxQty);
          syncToggleBtn();
        });
      });
      toggleBtn.addEventListener('click', () => {
        if (allAtMax()) {
          allInputs().forEach(inp => { inp.value = '0'; });
        } else {
          allInputs().forEach(inp => { inp.value = inp.max; });
        }
        syncToggleBtn();
      });
    }

    const close = (result: { name: string; qty: number }[] | null) => { backdrop.remove(); resolve(result); };

    (backdrop.querySelector('[data-action="restore"]') as HTMLButtonElement).addEventListener('click', () => {
      if (isOne) { close([{ name: items[0].name, qty: 1 }]); return; }
      // Stepper path: collect non-zero entries
      const restorations: { name: string; qty: number }[] = [];
      backdrop.querySelectorAll<HTMLInputElement>('.srmodal-qty-input').forEach(inp => {
        const qty = parseInt(inp.value, 10) || 0;
        if (qty > 0) restorations.push({ name: items[Number(inp.dataset.idx)].name, qty });
      });
      close(restorations);
    });
    const wasteBtn = backdrop.querySelector('[data-action="waste"]');
    if (wasteBtn) (wasteBtn as HTMLButtonElement).addEventListener('click', () => close([]));
    (backdrop.querySelector('[data-action="cancel"]') as HTMLButtonElement).addEventListener('click', () => close(null));

    (backdrop.querySelector('[data-action="restore"]') as HTMLButtonElement).focus();
  });
}

// ── KISMI ÖDEME SİSTEMİ ──────────────────────

let paySelections: PaySelection[] = [];
let discountType:  DiscountType   = 'pct';
let discountValue: number         = 0;

function completeOrder(): void {
  if (order.length === 0) return;

  paySelections = order.map((entry, idx) => ({
    orderIdx: idx,
    maxQty:   (entry.sentQty || 0) + (entry.pendingQty || 0),
    payQty:   0,
  }));

  discountType  = 'pct';
  discountValue = 0;
  const discBtnReset = document.getElementById('payDiscountBtn');
  if (discBtnReset) discBtnReset.textContent = 'İndirim Uygula';
  renderPayStep1();
  document.getElementById('payStep1')!.style.display  = '';
  document.getElementById('payStep2')!.style.display  = 'none';
  document.getElementById('paymentOverlay')!.classList.add('visible');
}

function renderPayStep1(): void {
  const list = document.getElementById('payItemsList')!;
  list.innerHTML = '';

  order.forEach((entry, idx) => {
    const sel = paySelections.find(s => s.orderIdx === idx);
    if (!sel) return;
    const et        = entry.extras.reduce((s, e) => s + (Number(e.price)||0), 0);
    const unitPrice = (Number(entry.product.price)||0) + et;
    const totalQty  = sel.maxQty;

    const row       = document.createElement('div');
    const extrasStr = entry.extras.length ? ' + ' + entry.extras.map(e => e.name).join(', ') : '';

    row.className = 'pay-item-row' + (sel.payQty > 0 ? ' pay-item-selected' : '');
    row.innerHTML =
      '<div class="pay-item-info">' +
        '<div class="pay-item-name">' + entry.product.icon + ' ' + entry.product.name + extrasStr + '</div>' +
        '<div class="pay-item-unit">\u20ba' + unitPrice + ' / adet — Masada: ' + totalQty + '</div>' +
      '</div>' +
      '<div class="pay-item-controls">' +
        '<button class="pay-qty-btn pay-minus" data-idx="' + idx + '">\u2212</button>' +
        '<span class="pay-qty-value" id="payQty-' + idx + '">' + sel.payQty + '</span>' +
        '<span class="pay-qty-sep">/ ' + totalQty + '</span>' +
        '<button class="pay-qty-btn pay-plus" data-idx="' + idx + '" data-max="' + totalQty + '">+</button>' +
      '</div>' +
      '<div class="pay-item-total" id="payTotal-' + idx + '">' +
        (sel.payQty > 0 ? '\u20ba' + (unitPrice * sel.payQty) : '\u2014') +
      '</div>';

    list.appendChild(row);
  });

  updatePayStep1Totals();

  list.querySelectorAll('.pay-minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLButtonElement).dataset.idx ?? '0', 10);
      const sel = paySelections.find(s => s.orderIdx === idx);
      if (sel && sel.payQty > 0) { sel.payQty--; refreshPayRow(idx); updatePayStep1Totals(); }
    });
  });
  list.querySelectorAll('.pay-plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt((btn as HTMLButtonElement).dataset.idx ?? '0', 10);
      const max = parseInt((btn as HTMLButtonElement).dataset.max ?? '0', 10);
      const sel = paySelections.find(s => s.orderIdx === idx);
      if (sel && sel.payQty < max) { sel.payQty++; refreshPayRow(idx); updatePayStep1Totals(); }
    });
  });
}

function refreshPayRow(orderIdx: number): void {
  const sel   = paySelections.find(s => s.orderIdx === orderIdx);
  const entry = order[orderIdx];
  if (!sel || !entry) return;
  const et        = entry.extras.reduce((s, e) => s + (Number(e.price)||0), 0);
  const unitPrice = (Number(entry.product.price)||0) + et;

  const qtyEl = document.getElementById('payQty-'   + orderIdx);
  const totEl = document.getElementById('payTotal-' + orderIdx);
  if (qtyEl) qtyEl.textContent = String(sel.payQty);
  if (totEl) totEl.textContent = sel.payQty > 0 ? ('\u20ba' + (unitPrice * sel.payQty)) : '\u2014';

  const rows   = document.querySelectorAll('.pay-item-row');
  const domIdx = paySelections.findIndex(s => s.orderIdx === orderIdx);
  if (rows[domIdx]) {
    rows[domIdx].classList.toggle('pay-item-selected', sel.payQty > 0);
  }
}

function updatePayStep1Totals(): void {
  let subtotal = 0;
  paySelections.forEach(sel => {
    const entry = order[sel.orderIdx];
    if (!entry) return;
    const et = entry.extras.reduce((s, e) => s + (Number(e.price)||0), 0);
    subtotal += ((Number(entry.product.price)||0) + et) * sel.payQty;
  });

  const tax   = Math.round(subtotal * TAX_RATE);
  const gross = subtotal + tax;

  let discountAmt = 0;
  if (discountValue > 0) {
    if (discountType === 'pct') {
      discountAmt = Math.round(gross * Math.min(discountValue, 100) / 100);
    } else {
      discountAmt = Math.min(discountValue, gross);
    }
  }
  const total = gross - discountAmt;

  const subEl = document.getElementById('paySubtotals');
  if (subEl) {
    const discountLine = discountAmt > 0
      ? '<span style="color:var(--success2)">İndirim: -\u20ba' + discountAmt + '</span>'
      : '';
    subEl.innerHTML =
      '<span>Ara: \u20ba' + subtotal + '</span>' +
      '<span>KDV: \u20ba' + tax + '</span>' +
      discountLine +
      '<span class="pay-total-bold">Toplam: \u20ba' + total + '</span>';
  }

  document.getElementById('paymentTotalDisplay')!.textContent = '\u20ba' + total;

  const anySelected = paySelections.some(s => s.payQty > 0);
  (document.getElementById('payStep1NextBtn') as HTMLButtonElement).disabled = !anySelected;

  const allSelected = paySelections.every(s => s.payQty === s.maxQty);
  const btn = document.getElementById('paySelectAllBtn');
  if (btn) btn.textContent = allSelected ? 'Tümünü Kaldır' : 'Tümünü Seç';
}

async function finalizeOrder(paymentType: string, cashAmount: number, cardAmount: number): Promise<void> {
  let subtotal = 0;
  const saleItems: SaleItem[] = [];

  paySelections.forEach(sel => {
    if (sel.payQty <= 0) return;
    const entry = order[sel.orderIdx];
    if (!entry) return;
    const et = entry.extras.reduce((s, e) => s + (Number(e.price)||0), 0);
    const unitPrice = (Number(entry.product.price)||0) + et;
    subtotal += unitPrice * sel.payQty;
    saleItems.push({
      name:      entry.product.name,
      icon:      entry.product.icon,
      qty:       sel.payQty,
      unitPrice: Number(entry.product.price) || 0,
      extras:    entry.extras.map(e => e.name),
      lineTotal: unitPrice * sel.payQty,
    });
  });

  const tax   = Math.round(subtotal * TAX_RATE);
  const gross = subtotal + tax;

  let discountAmt = 0;
  if (discountValue > 0) {
    if (discountType === 'pct') {
      discountAmt = Math.round(gross * Math.min(discountValue, 100) / 100);
    } else {
      discountAmt = Math.min(discountValue, gross);
    }
  }
  const total = gross - discountAmt;
  const now   = new Date();
  const id    = generateOrderId();
  const pad   = (n: number): string => String(n).padStart(2, '0');

  const sale: SaleRecord = {
    id,
    datetime: now.getFullYear() + '-' +
      pad(now.getMonth() + 1) + '-' +
      pad(now.getDate())      + ' ' +
      pad(now.getHours())     + ':' +
      pad(now.getMinutes())   + ':' +
      pad(now.getSeconds()),
    tableId:        activeTableId   || '',
    tableName:      activeTableName || '',
    subtotal,
    tax,
    discountAmount: discountAmt,
    total,
    paymentType,
    cashAmount,
    cardAmount,
    items: saleItems,
  };

  const saved = await DB.saveOrder(sale);
  if (saved) {
    // Trigger B: Deduct stock for items paid directly (not yet kitchen-sent)
    const directPayItems: { name: string; qty: number }[] = [];
    paySelections.forEach(sel => {
      if (sel.payQty <= 0) return;
      const entry = order[sel.orderIdx];
      if (!entry) return;
      const fromPending = Math.max(0, sel.payQty - (entry.sentQty || 0));
      if (fromPending > 0 && inventoryCache.some(iv => iv.product_name === entry.product.name)) {
        directPayItems.push({ name: entry.product.name, qty: fromPending });
      }
    });
    if (directPayItems.length > 0) {
      try {
        const result = await DB.deductStock(directPayItems) as DeductStockResult;
        inventoryCache = await DB.getInventory() as InventoryItem[];
        if (result.depleted && result.depleted.length > 0) {
          const names = result.depleted.join(', ');
          const depToast = document.createElement('div');
          depToast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#b45309;color:#fff;padding:10px 22px;border-radius:8px;z-index:9999;font-size:13px;font-weight:600;';
          depToast.textContent = '⚠️ Stok tükendi: ' + names;
          document.body.appendChild(depToast);
          setTimeout(() => depToast.remove(), 4000);
        }
      } catch (err) {
        console.error('[POS] Ödeme stok düşme hatası:', err);
      }
    }
    const tableDesc = activeTableName ? ' (' + activeTableName + ')' : '';

    // Build payment portion of the description
    let payDesc: string;
    if (paymentType === 'split') {
      payDesc = '₺' + total + ' Bölünmüş (Nakit: ₺' + cashAmount + ', Kart: ₺' + cardAmount + ')';
    } else {
      const payLabel = paymentType === 'cash' ? 'Nakit' : 'Kart';
      payDesc = '₺' + total + ' ' + payLabel;
    }

    // Compute remaining balance from un-selected items (qty decrement hasn't happened yet)
    let remainingSubtotal = 0;
    paySelections.forEach(sel => {
      const entry = order[sel.orderIdx];
      if (!entry) return;
      const et = entry.extras.reduce((s, e) => s + (Number(e.price) || 0), 0);
      remainingSubtotal += ((Number(entry.product.price) || 0) + et) * (sel.maxQty - sel.payQty);
    });
    const remainingTotal = remainingSubtotal > 0
      ? remainingSubtotal + Math.round(remainingSubtotal * TAX_RATE)
      : 0;
    const kalanSuffix = remainingTotal > 0 ? ' — Kalan: ₺' + remainingTotal : '';

    if (discountAmt > 0) {
      const discLabel = discountType === 'pct'
        ? '₺' + discountAmt + ' / %' + discountValue
        : '₺' + discountAmt;
      logActivity('order_discounted_payment',
        activeUser + tableDesc + ': ' + payDesc + ' (İndirim: ' + discLabel + ')' + kalanSuffix);
    } else {
      logActivity('order_payment',
        activeUser + tableDesc + ': ' + payDesc + kalanSuffix);
    }
  }
  if (!saved) {
    const notice = document.createElement('div');
    notice.style.cssText = 'position:fixed;top:16px;right:16px;background:#c0392b;color:#fff;padding:10px 18px;border-radius:8px;z-index:9999;font-size:13px;';
    notice.textContent = '\u26a0\ufe0f Veritabanı hatası — sipariş kaydedilemedi';
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 4000);
  }

  try {
    salesHistory     = await DB.getVisibleOrders();
    analyticsHistory = await DB.getAllOrders();
  } catch (e) {
    salesHistory.push(sale);
    analyticsHistory.push(sale);
  }
  renderHistory(id);

  document.getElementById('paymentOverlay')!.classList.remove('visible');

  discountValue = 0;
  discountType  = 'pct';
  const _discBtn = document.getElementById('payDiscountBtn');
  if (_discBtn) _discBtn.textContent = 'İndirim Uygula';

  paySelections.forEach(sel => {
    if (sel.payQty <= 0) return;
    const entry = order[sel.orderIdx];
    if (!entry) return;
    let remaining       = sel.payQty;
    const fromSent      = Math.min(remaining, entry.sentQty || 0);
    entry.sentQty       = (entry.sentQty    || 0) - fromSent;
    remaining          -= fromSent;
    const fromPending   = Math.min(remaining, entry.pendingQty || 0);
    entry.pendingQty    = (entry.pendingQty || 0) - fromPending;
  });

  order = order.filter(e => (e.sentQty||0) + (e.pendingQty||0) > 0);

  if (activeTableId) {
    if (order.length > 0) {
      tableOrders[activeTableId] = order.map(e => ({
        product:    e.product,
        extras:     e.extras.map(ex => ({ ...ex })),
        sentQty:    e.sentQty    || 0,
        pendingQty: e.pendingQty || 0,
        stockedQty: e.stockedQty,
      }));
      persistAllTables();
    } else {
      tableOrders[activeTableId] = [];
      clearPersistedTable(activeTableId);
    }
  }

  renderOrder();
  renderProducts();
  updateTotals();
  renderTableScreen();

  const payLabel = paymentType === 'cash' ? 'Nakit'
    : paymentType === 'card' ? 'Kart' : 'Bölünmüş';
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
    'background:#16a34a;color:#fff;padding:11px 26px;border-radius:8px;z-index:9999;' +
    'font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:opacity .4s';
  toast.textContent = '₺' + total + ' — ' + payLabel + ' ile ödeme alındı';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
}

function closeReceipt(): void {
  document.getElementById('modalOverlay')!.classList.remove('visible');
  if (receiptMode === 'preview') {
    receiptMode = 'payment';
    return;
  }
  renderOrder();
  renderProducts();
  updateTotals();
  renderTableScreen();
}

// ── GEÇMİŞ PANELİ ─────────────────────────────

async function openHistory(): Promise<void> {
  document.getElementById('historyPanel')!.classList.add('visible');
  document.getElementById('historyBackdrop')!.classList.add('visible');
  document.getElementById('historyToggleBtn')!.classList.add('active');

  const histAct  = document.getElementById('historyActions');
  const existBtn = document.getElementById('historyClearAllBtn');
  if (existBtn) existBtn.remove();
  if (histAct && userRole === 'admin') {
    const delBtn = document.createElement('button');
    delBtn.id          = 'historyClearAllBtn';
    delBtn.className   = 'history-clear-all-btn history-delete-btn';
    delBtn.title       = 'Seçili kayıtları gizle';
    delBtn.textContent = 'Sil';
    delBtn.addEventListener('click', handleHistoryDelete);
    histAct.appendChild(delBtn);
  }

  try {
    salesHistory = await DB.getVisibleOrders();
  } catch (e) {
    console.error('[POS] Geçmiş yüklenemedi:', e);
  }
  renderHistory();
}

function closeHistory(): void {
  document.getElementById('historyPanel')!.classList.remove('visible');
  document.getElementById('historyBackdrop')!.classList.remove('visible');
  document.getElementById('historyToggleBtn')!.classList.remove('active');
}

// ══════════════════════════════════════
//  MASA SİSTEMİ FONKSİYONLARI
// ══════════════════════════════════════

function calcTableTotal(tid: string): number {
  const items = tableOrders[tid] || [];
  const sub = items.reduce((s, e) => {
    const et    = (e.extras || []).reduce((es, ex) => es + (Number(ex.price) || 0), 0);
    const qty   = (Number(e.sentQty) || 0) + (Number(e.pendingQty) || 0);
    const price = Number(e.product && e.product.price) || 0;
    return s + (price + et) * qty;
  }, 0);
  return sub + Math.round(sub * TAX_RATE);
}

function renderTableScreen(): void {
  closeTableMenu();
  ZONES.forEach(zone => {
    const grid = document.getElementById(zone.gridId);
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 1; i <= zone.count; i++) {
      const tid      = zone.id + '-' + i;
      const tname    = zone.label + ' \u2014 Masa ' + i;
      const items    = tableOrders[tid] || [];
      const busy     = items.length > 0;
      const reserved = !!tableReservations[tid];
      const total    = calcTableTotal(tid);

      let cls = 'table-card';
      if (busy)     cls += ' occupied';
      if (reserved) cls += ' reserved';

      const dot = busy     ? '<div class="table-occupied-dot"></div>'
                : reserved ? '<div class="table-reserved-dot"></div>'
                :             '';

      const statusLabel = busy
        ? '<div class="table-item-count">\u20ba' + total.toLocaleString('tr-TR') + '</div>'
        : reserved
          ? '<div class="table-item-count table-reserved-label">Rezerve</div>'
          : '<div class="table-item-count" style="color:var(--text3)">Bo\u015f</div>';

      const card     = document.createElement('div');
      card.className = cls;
      const lastUser      = tableLastUser[tid] || '';
      const lastUserBadge = (busy && lastUser)
        ? '<div class="table-last-user">' + lastUser + '</div>'
        : '';

      card.innerHTML =
        dot +
        '<button class="table-menu-btn" title="Se\u00e7enekler">\u22ef</button>' +
        '<div class="table-number">' + i + '</div>' +
        '<div class="table-label">Masa</div>' +
        statusLabel +
        lastUserBadge;

      card.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as Element).closest('.table-menu-btn')) return;
        openTable(tid, tname);
      });

      (card.querySelector('.table-menu-btn') as HTMLButtonElement).addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        openTableMenu(tid, tname, busy, reserved, e.currentTarget as HTMLElement);
      });

      grid.appendChild(card);
    }
  });
}

// ══════════════════════════════════════
//  MASA BAĞLAM MENÜSÜ
// ══════════════════════════════════════

function closeTableMenu(): void {
  const m = document.getElementById('tableContextMenu');
  if (m) m.remove();
  _openMenuTid = null;
}

function openTableMenu(tid: string, tname: string, busy: boolean, reserved: boolean, _anchor: HTMLElement): void {
  if (_openMenuTid === tid) { closeTableMenu(); return; }
  closeTableMenu();
  _openMenuTid = tid;

  // ── Overlay (click-outside closes) ──────────────────────────
  const overlay     = document.createElement('div');
  overlay.id        = 'tableContextMenu';
  overlay.className = 'tmenu-overlay';
  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) closeTableMenu();
  });

  const modal     = document.createElement('div');
  modal.className = 'tmenu-modal';

  // ── Header ──────────────────────────────────────────────────
  const header     = document.createElement('div');
  header.className = 'tmenu-header';
  header.innerHTML =
    '<div class="tmenu-title">' + tname + '</div>' +
    '<div class="tmenu-subtitle">' + (busy ? 'Masa işlemini seçin' : 'Bu masa şu an boş') + '</div>';
  modal.appendChild(header);

  // ── SVG icon strings ─────────────────────────────────────────
  const ICO_SIPARISАЛ =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none">' +
      '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>' +
    '</svg>';
  const ICO_FIS =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none">' +
      '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '</svg>';
  const ICO_ODEME =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none">' +
      '<rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M2 10h20" stroke="currentColor" stroke-width="1.8"/>' +
      '<circle cx="7" cy="15" r="1.5" fill="currentColor"/>' +
    '</svg>';
  const ICO_AKTAR =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none">' +
      '<path d="M7 16l-4-4 4-4M17 8l4 4-4 4M3 12h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  const ICO_REZERVE =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none">' +
      '<rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
    '</svg>';

  // ── Primary 3-column grid ────────────────────────────────────
  const primaryGrid     = document.createElement('div');
  primaryGrid.className = 'tmenu-primary-grid';

  const primaryDefs = [
    { label: 'Sipariş Al', icon: ICO_SIPARISАЛ, theme: 'orange', disabled: !busy,
      fn: () => { closeTableMenu(); _openTableThen(tid, tname, showKitchenReceipt); } },
    { label: 'Fiş Yazdır', icon: ICO_FIS,       theme: 'grey',   disabled: !busy,
      fn: () => { closeTableMenu(); _openTableThen(tid, tname, showReceiptPreview); } },
    { label: 'Ödeme Al',   icon: ICO_ODEME,     theme: 'green',  disabled: !busy,
      fn: () => { closeTableMenu(); _openTableThen(tid, tname, completeOrder); } },
  ];

  primaryDefs.forEach(def => {
    const btn     = document.createElement('button');
    btn.className = 'tmenu-primary-btn tmenu-primary-btn--' + def.theme + (def.disabled ? ' disabled' : '');
    btn.innerHTML =
      '<span class="tmenu-btn-icon">' + def.icon + '</span>' +
      '<span class="tmenu-btn-label">' + def.label + '</span>';
    if (!def.disabled) btn.addEventListener('click', def.fn);
    primaryGrid.appendChild(btn);
  });
  modal.appendChild(primaryGrid);

  // ── Secondary 2-column row ───────────────────────────────────
  const secondaryGrid     = document.createElement('div');
  secondaryGrid.className = 'tmenu-secondary-grid';

  const secondaryDefs = [
    { label: 'Hesap Aktar',
      icon: ICO_AKTAR,
      disabled: !busy,
      fn: () => { closeTableMenu(); startHesapAktar(tid, tname); } },
    { label: reserved ? 'Rezervasyonu İptal Et' : 'Rezervasyon Yap',
      icon: ICO_REZERVE,
      disabled: false,
      fn: () => { closeTableMenu(); toggleReservation(tid); } },
  ];

  secondaryDefs.forEach(def => {
    const btn     = document.createElement('button');
    btn.className = 'tmenu-secondary-btn' + (def.disabled ? ' disabled' : '');
    btn.innerHTML =
      '<span class="tmenu-btn-icon">' + def.icon + '</span>' +
      '<span class="tmenu-btn-label">' + def.label + '</span>';
    if (!def.disabled) btn.addEventListener('click', def.fn);
    secondaryGrid.appendChild(btn);
  });
  modal.appendChild(secondaryGrid);

  // ── Close button (full-width, neutral) ───────────────────────
  const closeBtn     = document.createElement('button');
  closeBtn.className = 'tmenu-close-btn';
  closeBtn.textContent = 'Kapat';
  closeBtn.addEventListener('click', closeTableMenu);
  modal.appendChild(closeBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function _openTableThen(tid: string, tname: string, action: () => void): void {
  openTable(tid, tname);
  setTimeout(action, 60);
}

// ── HESAP AKTAR ───────────────────────────────

function startHesapAktar(fromTid: string, fromTname: string): void {
  const targets: TransferTarget[] = [];
  ZONES.forEach(zone => {
    for (let i = 1; i <= zone.count; i++) {
      const tid    = zone.id + '-' + i;
      if (tid === fromTid) continue;
      const isBusy = (tableOrders[tid] || []).length > 0;
      targets.push({ tid, label: zone.label + ' \u2014 Masa ' + i, busy: isBusy });
    }
  });
  showTransferModal(fromTid, fromTname, targets);
}

function showTransferModal(fromTid: string, fromTname: string, targets: TransferTarget[]): void {
  const old = document.getElementById('transferModal');
  if (old) old.remove();

  const overlay     = document.createElement('div');
  overlay.id        = 'transferModal';
  overlay.className = 'transfer-modal-overlay';

  const box     = document.createElement('div');
  box.className = 'transfer-modal-box';

  const title       = document.createElement('div');
  title.className   = 'transfer-modal-title';
  title.textContent = 'Hesap Aktar';
  box.appendChild(title);

  const sub1     = document.createElement('div');
  sub1.className = 'transfer-modal-sub';
  sub1.innerHTML = 'Kaynak: <strong>' + fromTname + '</strong>';
  box.appendChild(sub1);

  const sub2               = document.createElement('div');
  sub2.className           = 'transfer-modal-sub';
  sub2.style.marginBottom  = '10px';
  sub2.textContent         = 'Hedef masa se\u00e7in:';
  box.appendChild(sub2);

  const list     = document.createElement('div');
  list.className = 'transfer-target-list';
  targets.forEach(t => {
    const btn                 = document.createElement('button');
    btn.className             = 'transfer-target-btn';
    btn.dataset.tid           = t.tid;
    btn.dataset.tolabel       = t.label;

    const nameSpan            = document.createElement('span');
    nameSpan.textContent      = t.label;

    const badge               = document.createElement('span');
    badge.className           = t.busy ? 'transfer-busy-badge' : 'transfer-empty-badge';
    badge.textContent         = t.busy ? 'Me\u015fgul' : 'Bo\u015f';

    btn.appendChild(nameSpan);
    btn.appendChild(badge);
    list.appendChild(btn);
  });
  box.appendChild(list);

  const cancelBtn           = document.createElement('button');
  cancelBtn.className       = 'transfer-cancel-btn';
  cancelBtn.textContent     = '\u0130ptal';
  cancelBtn.addEventListener('click', () => overlay.remove());
  box.appendChild(cancelBtn);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) overlay.remove(); });

  list.querySelectorAll('.transfer-target-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const b       = btn as HTMLButtonElement;
      const toTid   = b.dataset.tid   ?? '';
      const toLabel = b.dataset.tolabel ?? '';
      overlay.remove();
      doHesapAktar(fromTid, fromTname, toTid, toLabel);
    });
  });
}

function doHesapAktar(fromTid: string, fromTname: string, toTid: string, toLabel: string): void {
  const fromItems = (tableOrders[fromTid] || []).map(e => ({
    product:    e.product,
    extras:     (e.extras || []).map(ex => ({ ...ex })),
    sentQty:    e.sentQty    || 0,
    pendingQty: e.pendingQty || 0,
    stockedQty: e.stockedQty,
  }));
  tableOrders[toTid]   = [...(tableOrders[toTid] || []), ...fromItems];
  tableOrders[fromTid] = [];
  if (activeUser) tableLastUser[toTid] = activeUser;
  delete tableLastUser[fromTid];
  persistAllTables();
  renderTableScreen();

  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
    'background:#16a34a;color:#fff;padding:10px 22px;border-radius:8px;z-index:9999;' +
    'font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:opacity .4s';
  toast.textContent = fromTname + ' \u2192 ' + toLabel + ' aktar\u0131ld\u0131';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 2500);
}

// ── REZERVASYON ───────────────────────────────

function toggleReservation(tid: string): void {
  if (tableReservations[tid]) {
    delete tableReservations[tid];
  } else {
    tableReservations[tid] = true;
  }
  saveReservations();
  renderTableScreen();
}

function openTable(tableId: string, tableName: string): void {
  activeTableId   = tableId;
  activeTableName = tableName;
  order = (tableOrders[tableId] || []).map(e => ({
    product:    e.product,
    extras:     e.extras.map(ex => ({ ...ex })),
    sentQty:    e.sentQty    || 0,
    pendingQty: e.pendingQty || 0,
    stockedQty: e.stockedQty,
  }));

  document.getElementById('tableScreen')!.style.display  = 'none';
  document.getElementById('posTopbar')!.style.display    = '';
  document.getElementById('posLayout')!.style.display    = '';

  const ctxBar  = document.getElementById('tableContextBar');
  const ctxText = document.getElementById('tableContextText');
  if (ctxBar && ctxText) {
    ctxText.textContent  = tableName.toUpperCase();
    ctxBar.style.display = '';
  }

  const titleEl = document.getElementById('orderTableTitle');
  if (titleEl) titleEl.textContent = tableName;

  activeExtras        = [];
  activeDessertExtras = [];

  renderOrder();
  renderProducts();
  renderExtras();
}

// ── AKTİF MASA SİPARİŞLERİ — localStorage ────

const LS_TABLES      = 'kahve_pos_table_orders';
const LS_TABLE_NAMES: Record<string, string> = {};

function persistAllTables(): void {
  try {
    const toSave: Record<string, unknown> = {};
    for (const [tid, items] of Object.entries(tableOrders)) {
      if (!items || items.length === 0) continue;
      const tname = (tid === activeTableId ? activeTableName : '') ||
                    LS_TABLE_NAMES[tid] || tid;
      toSave[tid] = {
        tableName: tname,
        lastUser:  tableLastUser[tid] || '',
        items: items.map(e => ({
          productId:  e.product.id,
          name:       e.product.name,
          price:      e.product.price,
          icon:       e.product.icon  || '☕',
          cat:        e.product.cat   || 'hot',
          desc:       e.product.desc  || '',
          badge:      e.product.badge || '',
          sentQty:    e.sentQty    || 0,
          pendingQty: e.pendingQty || 0,
          stockedQty: e.stockedQty,
          extras:     e.extras,
        })),
      };
    }
    localStorage.setItem(LS_TABLES, JSON.stringify(toSave));
  } catch (e) {
    console.error('[POS] persistAllTables hatası:', e);
  }
}

interface PersistedItem {
  productId:   number | string;
  name:        string;
  price:       number;
  icon:        string;
  cat:         string;
  desc:        string;
  badge:       string;
  sentQty:     number;
  pendingQty:  number;
  stockedQty?: number;
  extras:      Extra[];
}

interface PersistedTable {
  tableName: string;
  lastUser:  string;
  items:     PersistedItem[];
}

function loadPersistedTables(): void {
  try {
    const raw = localStorage.getItem(LS_TABLES);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, PersistedTable>;
    for (const [tid, data] of Object.entries(saved)) {
      if (!data.items || data.items.length === 0) continue;
      LS_TABLE_NAMES[tid] = data.tableName || tid;
      if (data.lastUser) tableLastUser[tid] = data.lastUser;
      tableOrders[tid] = data.items.map(item => {
        const product: Product = MENU.find(m => m.id === item.productId) || {
          id:    item.productId,
          name:  item.name,
          price: item.price,
          icon:  item.icon  || '☕',
          cat:   item.cat   || 'hot',
          desc:  item.desc  || '',
          badge: item.badge || '',
        };
        return { product, extras: item.extras || [], sentQty: item.sentQty || 0, pendingQty: item.pendingQty || 0, stockedQty: item.stockedQty };
      });
    }
    console.log('[POS] Aktif masa siparişleri geri yüklendi:', Object.keys(tableOrders).length, 'masa');
  } catch (e) {
    console.error('[POS] loadPersistedTables hatası:', e);
  }
}

function clearPersistedTable(tableId: string): void {
  try {
    const raw = localStorage.getItem(LS_TABLES);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    delete saved[tableId];
    localStorage.setItem(LS_TABLES, JSON.stringify(saved));
  } catch (e) { /* ignore */ }
  delete tableLastUser[tableId];
}

function saveTableOrder(): void {
  if (!activeTableId) return;
  tableOrders[activeTableId] = order.map(e => ({
    product:    e.product,
    extras:     e.extras.map(ex => ({ ...ex })),
    sentQty:    e.sentQty    || 0,
    pendingQty: e.pendingQty || 0,
    stockedQty: e.stockedQty,
  }));
  LS_TABLE_NAMES[activeTableId] = activeTableName;
  if (activeUser) tableLastUser[activeTableId] = activeUser;
  persistAllTables();
}

function goBackToTables(): void {
  saveTableOrder();
  activeTableId   = null;
  activeTableName = '';
  order           = [];
  showTableScreenDirect();
}

async function showKitchenReceipt(): Promise<void> {
  const newItems = order.filter(e => (e.pendingQty || 0) > 0);
  if (newItems.length === 0) {
    await showAlert('Mutfak Bildirimi', 'Gönderilecek yeni ürün yok.\nTüm ürünler zaten mutfağa bildirildi.', 'info');
    return;
  }

  const now = new Date();
  document.getElementById('kitchenTableName')!.textContent = activeTableName || 'Masa';
  document.getElementById('kitchenTime')!.textContent =
    now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  const itemsEl = document.getElementById('kitchenItems')!;
  itemsEl.innerHTML = newItems.map(entry => {
    const extrasLine = entry.extras.length > 0
      ? '<div class="kitchen-item-extras">+ ' + entry.extras.map(e => e.name).join(', ') + '</div>'
      : '';
    return '<div class="kitchen-item">' +
      '<div class="kitchen-item-qty">' + entry.pendingQty + 'x</div>' +
      '<div class="kitchen-item-name">' + entry.product.name + extrasLine + '</div>' +
      '</div>';
  }).join('');

  document.getElementById('kitchenOverlay')!.classList.add('visible');

  const kitchenTableDesc = activeTableName ? ' ' + activeTableName + ' için' : '';
  const kitchenDetails = newItems.map(e => {
    const ext = e.extras.length > 0 ? ' (' + e.extras.map(x => x.name).join(', ') + ')' : '';
    return e.pendingQty + 'x ' + e.product.name + ext;
  }).join('\n');
  logActivity(
    'order_kitchen',
    activeUser + kitchenTableDesc + ' sipariş gönderdi',
    kitchenDetails,
  );

  // Trigger A: Deduct inventory stock for items being sent to kitchen
  const kitchenStockItems = newItems
    .filter(e => inventoryCache.some(iv => iv.product_name === e.product.name))
    .map(e => ({ name: e.product.name, qty: e.pendingQty as number }));

  // Capture pre-deduction available stock per product (before DB call).
  // Used to compute how many units genuinely came from the shelf (stockedQty).
  const preDeductAvail: Record<string, number> = {};
  kitchenStockItems.forEach(item => {
    if (!(item.name in preDeductAvail)) {
      const inv = inventoryCache.find(iv => iv.product_name === item.name);
      preDeductAvail[item.name] = inv ? Math.max(0, inv.stock_quantity) : 0;
    }
  });

  if (kitchenStockItems.length > 0) {
    try {
      const result = await DB.deductStock(kitchenStockItems) as DeductStockResult;
      inventoryCache = await DB.getInventory() as InventoryItem[];
      if (result.depleted && result.depleted.length > 0) {
        // Items that hit 0 — show toast but still allow this last batch through
        const names = result.depleted.join(', ');
        const depletedToast = document.createElement('div');
        depletedToast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#b45309;color:#fff;padding:10px 22px;border-radius:8px;z-index:9999;font-size:13px;font-weight:600;';
        depletedToast.textContent = '⚠️ Stok tükendi: ' + names;
        document.body.appendChild(depletedToast);
        setTimeout(() => depletedToast.remove(), 4000);
      }
    } catch (err) {
      console.error('[POS] Mutfak stok düşme hatası:', err);
    }
  }

  // Promote pending → sent. For tracked products, record how many units actually
  // came from the physical shelf (first-come-first-served across multiple entries).
  const stockRemaining: Record<string, number> = { ...preDeductAvail };
  newItems.forEach(entry => {
    if (entry.product.name in preDeductAvail) {
      const avail   = stockRemaining[entry.product.name] ?? 0;
      const stocked = Math.min(entry.pendingQty, avail);
      entry.stockedQty  = (entry.stockedQty || 0) + stocked;
      stockRemaining[entry.product.name] = avail - stocked;
    }
    entry.sentQty    = (entry.sentQty || 0) + entry.pendingQty;
    entry.pendingQty = 0;
  });
  if (activeTableId && activeUser) {
    tableLastUser[activeTableId] = activeUser;
    persistAllTables();
  } else {
    saveTableOrder();
  }
  renderOrder();
  renderProducts();
  updateTotals();
}

function showReceiptPreview(): void {
  if (order.length === 0) return;

  const subtotal = order.reduce((sum, entry) => {
    const et  = entry.extras.reduce((s, e) => s + e.price, 0);
    const qty = (entry.sentQty || 0) + (entry.pendingQty || 0);
    return sum + (entry.product.price + et) * qty;
  }, 0);
  const tax   = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax;
  const now   = new Date();

  const itemsHtml = order.map(entry => {
    const et        = entry.extras.reduce((s, e) => s + e.price, 0);
    const qty       = (entry.sentQty || 0) + (entry.pendingQty || 0);
    const linePrice = (entry.product.price + et) * qty;
    const extrasLine = entry.extras.length > 0
      ? '<div class="receipt-extras-line">+ ' + entry.extras.map(e => e.name).join(', ') + '</div>'
      : '';
    return '<div class="receipt-row">' +
      '<span class="receipt-row-name">' + entry.product.name + '</span>' +
      '<span class="receipt-row-qty">×' + qty + '</span>' +
      '<span class="receipt-row-price">₺' + linePrice + '</span>' +
      '</div>' + extrasLine;
  }).join('');

  const totalsHtml =
    '<div class="receipt-total-row"><span>Ara Toplam</span><span>₺' + subtotal + '</span></div>' +
    '<div class="receipt-total-row"><span>KDV (%8)</span><span>₺' + tax + '</span></div>' +
    '<div class="receipt-total-row grand"><span>TOPLAM</span><span>₺' + total + '</span></div>';

  document.getElementById('receiptDate')!.textContent =
    now.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }) +
    ' — ' + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('receiptOrderId')!.textContent = activeTableName || 'Ön İzleme';
  document.getElementById('receiptItems')!.innerHTML   = itemsHtml;
  document.getElementById('receiptTotals')!.innerHTML  = totalsHtml;

  receiptMode = 'preview';
  document.getElementById('newOrderBtn')!.style.display  = 'none';
  document.getElementById('receiptOkBtn')!.style.display = '';
  document.getElementById('modalOverlay')!.classList.add('visible');

  const receiptTableDesc = activeTableName ? ' ' + activeTableName + ' için' : '';
  logActivity('order_receipt', activeUser + receiptTableDesc + ' fiş yazdırdı');
}

// ── KATEGORİ NAVİGASYONU ──────────────────────

function initCategoryNav(): void {
  const nav = document.getElementById('categoryNav')!;
  nav.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', function(this: HTMLElement) {
      nav.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      activeCategory = (this as HTMLButtonElement).dataset.cat ?? 'all';
      renderProducts();
    });
  });
}

// ── SAAT ──────────────────────────────────────

function startClock(): void {
  function tick(): void {
    const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ['timeDisplay','timeDisplayTable','timeDisplaySelection','timeDisplayAnalytics','timeDisplayStaff','timeDisplayLogs','timeDisplayProductSales','timeDisplayInventory'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    });
  }
  tick();
  setInterval(tick, 1000);
}

// ── TARİH YARDIMCISI ──────────────────────────

function parseSaleDate(datetime: string): { date: string; time: string } {
  if (!datetime) return { date: '', time: '' };
  const clean = datetime.replace('T', ' ').split('.')[0];
  const [datePart, timePart] = clean.split(' ');
  if (!datePart) return { date: '', time: '' };
  const [y, m, d] = datePart.split('-');
  const [h, mn]   = (timePart || '00:00').split(':');
  const date = (d || '').padStart(2,'0') + '.' + (m || '').padStart(2,'0') + '.' + (y || '');
  const time = (h || '00').padStart(2,'0') + ':' + (mn || '00').padStart(2,'0');
  return { date, time };
}

// ── DIŞA AKTARMA ──────────────────────────────

function buildCSV(orders: SaleRecord[]): string {
  const SEP = ';';
  const BOM = '\uFEFF';
  const NL  = '\r\n';

  const esc = (v: unknown): string => {
    const s = String(v === null || v === undefined ? '' : v);
    return (s.includes(SEP) || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };

  const row = (cols: unknown[]): string => cols.map(esc).join(SEP);

  const lines: string[] = [];
  lines.push(row([
    'Siparis ID', 'Tarih ve Saat',
    'Urun', 'Adet', 'Ekstralar',
    'Birim Fiyat (TL)', 'Satir Toplam (TL)',
    'Ara Toplam (TL)', 'KDV (TL)', 'Toplam (TL)',
    'Odeme Tipi', 'Nakit (TL)', 'Kart (TL)',
  ]));

  for (const sale of orders) {
    const { date, time } = parseSaleDate(sale.datetime);
    const pt    = sale.paymentType || 'cash';
    const ptLbl = pt === 'cash' ? 'Nakit' : pt === 'card' ? 'Kart' : 'Bolunmus';
    const saleC = pt === 'cash' ? sale.total : (sale.cashAmount || 0);
    const saleD = pt === 'card' ? sale.total : (sale.cardAmount || 0);

    const items: (SaleItem | null)[] = sale.items.length > 0 ? sale.items : [null];
    items.forEach((item, i) => {
      const dateTimeCell = i === 0 ? ('\t' + date + ' ' + time) : '';
      lines.push(row([
        i === 0 ? sale.id       : '',
        dateTimeCell,
        item ? item.name        : '',
        item ? item.qty         : '',
        item ? (item.extras.join(' + ') || '-') : '',
        item ? item.unitPrice   : '',
        item ? item.lineTotal   : '',
        i === 0 ? sale.subtotal : '',
        i === 0 ? sale.tax      : '',
        i === 0 ? sale.total    : '',
        i === 0 ? ptLbl         : '',
        i === 0 ? saleC         : '',
        i === 0 ? saleD         : '',
      ]));
    });
  }

  const grandTotal = orders.reduce((s, o) => s + o.total, 0);
  const grandCash  = orders.reduce((s, o) => {
    const p = o.paymentType || 'cash';
    return s + (p === 'cash' ? o.total : p === 'split' ? (o.cashAmount || 0) : 0);
  }, 0);
  const grandCard  = orders.reduce((s, o) => {
    const p = o.paymentType || 'cash';
    return s + (p === 'card' ? o.total : p === 'split' ? (o.cardAmount || 0) : 0);
  }, 0);

  lines.push(row(Array(13).fill('')));
  lines.push(row(['OZET', '', '', '', '', '', '', '', '', '', '', '', '']));
  lines.push(row(['Toplam Siparis', orders.length + ' adet', '', '', '', '', '', '', '', 'Genel Toplam (TL)', grandTotal, '', '']));
  lines.push(row(['Toplam Nakit (TL)', grandCash, '', '', '', '', '', '', '', '', '', '', '']));
  lines.push(row(['Toplam Kredi Karti (TL)', grandCard, '', '', '', '', '', '', '', '', '', '', '']));

  return BOM + lines.join(NL);
}

function buildExcelHTML(orders: SaleRecord[]): string {
  const now        = new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' });
  const statsTotal = orders.reduce((s, o) => s + o.total, 0);
  const statsCash  = orders.reduce((s, o) => {
    const p = o.paymentType || 'cash';
    return s + (p === 'cash' ? o.total : p === 'split' ? (o.cashAmount || 0) : 0);
  }, 0);
  const statsCard  = orders.reduce((s, o) => {
    const p = o.paymentType || 'cash';
    return s + (p === 'card' ? o.total : p === 'split' ? (o.cardAmount || 0) : 0);
  }, 0);
  const todayStr   = new Date().toDateString();
  const statsToday = orders.filter(o => new Date(o.datetime).toDateString() === todayStr)
                           .reduce((s, o) => s + o.total, 0);

  let detailRows = '';
  orders.slice().reverse().forEach(sale => {
    const { date, time } = parseSaleDate(sale.datetime);
    const pt    = sale.paymentType || 'cash';
    const ptLbl = pt === 'cash' ? 'Nakit' : pt === 'card' ? 'Kart' : 'Bölünmüş';
    const saleC = pt === 'cash' ? sale.total : (sale.cashAmount || 0);
    const saleD = pt === 'card' ? sale.total : (sale.cardAmount || 0);

    const itemList: (SaleItem | null)[] = sale.items.length > 0 ? sale.items : [null];
    itemList.forEach((item, i) => {
      const bg = i % 2 === 0 ? '' : ' style="background:#f7f8fc"';
      detailRows +=
        '<tr' + bg + '>' +
        '<td style="white-space:nowrap">'                                          + (i === 0 ? sale.id : '') + '</td>' +
        '<td style="white-space:nowrap;mso-number-format:\'\\@\'">'               + (i === 0 ? date   : '') + '</td>' +
        '<td style="white-space:nowrap">'                                          + (i === 0 ? time   : '') + '</td>' +
        '<td>'                                                                     + (item ? item.name : '') + '</td>' +
        '<td style="text-align:center">'                                           + (item ? item.qty  : '') + '</td>' +
        '<td>'                                                                     + (item ? (item.extras.join(', ') || '-') : '') + '</td>' +
        '<td style="text-align:right">'                                            + (i === 0 ? sale.subtotal.toLocaleString('tr-TR') : '') + '</td>' +
        '<td style="text-align:right">'                                            + (i === 0 ? sale.tax.toLocaleString('tr-TR')      : '') + '</td>' +
        '<td style="text-align:right;font-weight:bold">'                           + (i === 0 ? sale.total.toLocaleString('tr-TR')    : '') + '</td>' +
        '<td style="text-align:center">'                                           + (i === 0 ? ptLbl  : '') + '</td>' +
        '<td style="text-align:right">'                                            + (i === 0 && saleC ? saleC.toLocaleString('tr-TR') : '') + '</td>' +
        '<td style="text-align:right">'                                            + (i === 0 && saleD ? saleD.toLocaleString('tr-TR') : '') + '</td>' +
        '</tr>\n';
    });
  });

  let html = '<?xml version="1.0" encoding="UTF-8"?>\n';
  html += '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n';
  html += '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/>\n';
  html += '<style>\n';
  html += '  body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; }\n';
  html += '  h1   { font-size: 13pt; color: #1e3a5f; margin-bottom: 3px; font-weight: bold; }\n';
  html += '  .meta { color: #666; font-size: 9pt; margin-bottom: 10px; }\n';
  html += '  table.main { border-collapse: collapse; width: 100%; min-width: 900px; }\n';
  html += '  th { background:#1e3a5f; color:#fff; padding:7px 12px; text-align:left; font-size:9pt; white-space:nowrap; }\n';
  html += '  td { padding:5px 12px; border-bottom:1px solid #e8ecf0; font-size:10pt; vertical-align:top; white-space:nowrap; }\n';
  html += '  .total-row td { font-weight:bold; background:#e8f5e9; color:#1b5e20; border-top:2px solid #1b5e20; }\n';
  html += '  .cash-row  td { background:#f0fdf4; color:#15803d; font-weight:bold; }\n';
  html += '  .card-row  td { background:#eff6ff; color:#1d4ed8; font-weight:bold; }\n';
  html += '  .sep-row   td { background:#f8fafc; border:none; padding:3px; }\n';
  html += '</style></head><body>\n';
  html += '<h1>Kahve POS \u2014 Sat\u0131\u015f Raporu</h1>\n';
  html += '<div class="meta">Olu\u015fturulma: ' + now + ' &nbsp;|&nbsp; Toplam Sipari\u015f: ' + orders.length + ' &nbsp;|&nbsp; Bug\u00fcn: \u20ba' + statsToday.toLocaleString('tr-TR') + '</div>\n';
  html += '<table class="main"><thead><tr>';
  html += '<th style="min-width:110px">Sipari\u015f ID</th>';
  html += '<th style="min-width:110px">Tarih</th>';
  html += '<th style="min-width:60px">Saat</th>';
  html += '<th style="min-width:150px">\u00dcr\u00fcn</th>';
  html += '<th style="min-width:45px">Adet</th>';
  html += '<th style="min-width:120px">Ekstralar</th>';
  html += '<th style="min-width:90px">Ara Toplam (\u20ba)</th>';
  html += '<th style="min-width:70px">KDV (\u20ba)</th>';
  html += '<th style="min-width:80px">Toplam (\u20ba)</th>';
  html += '<th style="min-width:85px">\u00d6deme Tipi</th>';
  html += '<th style="min-width:80px">Nakit (\u20ba)</th>';
  html += '<th style="min-width:80px">Kart (\u20ba)</th>';
  html += '</tr></thead><tbody>\n';
  html += detailRows;
  html += '<tr class="sep-row"><td colspan="12"></td></tr>\n';
  html += '<tr class="total-row">';
  html += '<td colspan="8">GENEL TOPLAM (' + orders.length + ' sipari\u015f)</td>';
  html += '<td style="text-align:right">' + statsTotal.toLocaleString('tr-TR') + '</td>';
  html += '<td></td><td></td><td></td></tr>\n';
  html += '<tr class="cash-row">';
  html += '<td colspan="10">Toplam Nakit</td>';
  html += '<td style="text-align:right">' + statsCash.toLocaleString('tr-TR') + '</td>';
  html += '<td></td></tr>\n';
  html += '<tr class="card-row">';
  html += '<td colspan="11">Toplam Kredi Kart\u0131</td>';
  html += '<td style="text-align:right">' + statsCard.toLocaleString('tr-TR') + '</td>';
  html += '</tr>\n';
  html += '</tbody></table></body></html>';
  return html;
}

async function exportToCSV(): Promise<void> {
  if (salesHistory.length === 0) { await showAlert('Dışa Aktar', 'Dışa aktarılacak satış verisi yok.', 'info'); return; }
  const btn = document.getElementById('exportCsvBtn')!;
  btn.classList.add('loading');
  try {
    const csv    = buildCSV(salesHistory);
    const result = await DB.exportCSV(csv);
    if (result.ok) {
      showExportToast('Excel kaydedildi ✓');
    } else if (result.reason !== 'canceled') {
      await showAlert('Dışa Aktar', 'CSV kaydedilemedi: ' + result.reason, 'error');
    }
  } finally {
    btn.classList.remove('loading');
  }
}

async function exportToExcel(): Promise<void> {
  if (salesHistory.length === 0) { await showAlert('Dışa Aktar', 'Dışa aktarılacak satış verisi yok.', 'info'); return; }
  const btn = document.getElementById('exportExcelBtn')!;
  btn.classList.add('loading');
  try {
    const html   = buildExcelHTML(salesHistory);
    const result = await DB.exportExcel(html);
    if (result.ok) {
      showExportToast('Excel kaydedildi ✓');
    } else if (result.reason !== 'canceled') {
      await showAlert('Dışa Aktar', 'Excel kaydedilemedi: ' + result.reason, 'error');
    }
  } finally {
    btn.classList.remove('loading');
  }
}

function showExportToast(msg: string): void {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#27ae60;color:#fff;padding:10px 20px;border-radius:10px;z-index:9999;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:opacity .4s';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2500);
}

// ══════════════════════════════════════
//  KİMLİK DOĞRULAMA
// ══════════════════════════════════════

const USERS: User[] = [
  { username: 'admin', password: '1234' },
  { username: 'Tolga', password: 'abcd' },
  { username: 'Ayşe',  password: 'efgh' },
];

localStorage.removeItem('kahve_pos_auth');

let _sessionActive: boolean         = false;
let activeUser:     string          = '';
let userRole:       UserRole | ''   = '';
let _loginMode:     'admin' | 'staff' = 'admin';

function isLoggedIn(): boolean {
  return _sessionActive;
}

function showPOS(): void {
  const overlay = document.getElementById('loginOverlay')!;
  overlay.style.display = 'none';
  overlay.classList.remove('active');

  const userIconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="flex-shrink:0">' +
    '<circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.7"/>' +
    '<path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '</svg>';
  const label = activeUser
    ? (userIconSvg + '<span>' + activeUser + '</span>')
    : '';
  ['activeUserChip','activeUserChipTable','activeUserChipSelection','activeUserChipAnalytics','activeUserChipStaff','activeUserChipLogs','activeUserChipProductSales','activeUserChipInventory'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = label;
  });

  if (userRole === 'admin') {
    showSelectionScreen();
  } else {
    showTableScreenDirect();
  }
}

function hideAllScreens(): void {
  ['selectionScreen','posTopbar','posLayout','tableScreen','analyticsScreen','staffScreen','logsScreen','productSalesScreen','inventoryScreen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const ctxBar = document.getElementById('tableContextBar');
  if (ctxBar) ctxBar.style.display = 'none';
}

function showSelectionScreen(): void {
  hideAllScreens();
  document.getElementById('selectionScreen')!.style.display = '';
}

function showTableScreenDirect(): void {
  hideAllScreens();
  document.getElementById('tableScreen')!.style.display = '';
  const backBtn = document.getElementById('tableScreenBackBtn');
  if (backBtn) backBtn.style.display = userRole === 'admin' ? '' : 'none';
  renderTableScreen();
}

function guardAdmin(onPass: () => void): void {
  if (userRole !== 'admin') {
    const overlay = document.createElement('div');
    overlay.className = 'access-denied-overlay';
    overlay.innerHTML =
      '<div class="access-denied-box">' +
        '<div class="access-denied-icon">🔒</div>' +
        '<h2 class="access-denied-title">Erişim Reddedildi</h2>' +
        '<p class="access-denied-msg">Bu bölüm yalnızca yöneticilere açıktır.</p>' +
        '<button class="access-denied-btn" id="accessDeniedOkBtn">Tamam</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('accessDeniedOkBtn')!.addEventListener('click', () => overlay.remove());
    return;
  }
  onPass();
}

function showAnalyticsDashboard(): void {
  guardAdmin(async () => {
    hideAllScreens();
    document.getElementById('analyticsScreen')!.style.display = '';
    // Derive period from shared filter state
    if (analyticsMonth)    analyticsPeriod = 'monthly';
    else if (analyticsDay) analyticsPeriod = 'daily';
    // Sync UI to shared state
    (document.getElementById('analyticsMonthFilter') as HTMLInputElement).value = analyticsMonth || '';
    (document.getElementById('analyticsDayFilter')   as HTMLInputElement).value = analyticsDay   || '';
    (document.getElementById('analyticsRelativeNInput') as HTMLInputElement).value = analyticsRelativeN !== null ? String(analyticsRelativeN) : '';
    if (analyticsRelativeUnit) (document.getElementById('analyticsRelativeUnitSelect') as HTMLSelectElement).value = analyticsRelativeUnit;
    document.querySelectorAll('#periodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
    if (analyticsRelativeN === null) {
      const activeTab = document.querySelector('#periodBtnGroup [data-period="' + analyticsPeriod + '"]');
      if (activeTab) activeTab.classList.add('active');
    }
    updateAnalyticsFilterState();
    try {
      analyticsHistory = await DB.getAllOrders();
    } catch (e) {
      console.error('[POS] Analitik veri yüklenemedi:', e);
    }
    renderAnalyticsCharts();
  });
}

function showStaffManagement(): void {
  guardAdmin(() => {
    hideAllScreens();
    document.getElementById('staffScreen')!.style.display = '';
    loadAndRenderStaff();
  });
}

function showLogsScreen(): void {
  guardAdmin(() => {
    hideAllScreens();
    document.getElementById('logsScreen')!.style.display = '';
    loadAndRenderLogs();
  });
}

// ── ÜRÜN SATIŞ VERİLERİ ──────────────────────

function showProductSalesScreen(): void {
  guardAdmin(async () => {
    hideAllScreens();
    document.getElementById('productSalesScreen')!.style.display = '';
    // Restore own independent filter state (does not touch Analytics state)
    (document.getElementById('productSalesMonthFilter') as HTMLInputElement).value = productSalesMonth || '';
    (document.getElementById('productSalesDayFilter')   as HTMLInputElement).value = productSalesDay   || '';
    (document.getElementById('productSalesRelativeNInput') as HTMLInputElement).value = productSalesRelativeN !== null ? String(productSalesRelativeN) : '';
    if (productSalesRelativeUnit) (document.getElementById('productSalesRelativeUnitSelect') as HTMLSelectElement).value = productSalesRelativeUnit;
    document.querySelectorAll('#productSalesPeriodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
    if (productSalesRelativeN === null) {
      const activeTab = document.querySelector('#productSalesPeriodBtnGroup [data-period="' + productSalesPeriod + '"]');
      if (activeTab) activeTab.classList.add('active');
    }
    updateProductSalesFilterState();
    try {
      productSalesHistory = await DB.getAllOrders();
    } catch (e) {
      console.error('[ProductSales] Veri yüklenemedi:', e);
    }
    renderProductSalesTable();
  });
}

// ── STOK YÖNETİMİ ────────────────────────────

function showInventoryScreen(): void {
  guardAdmin(async () => {
    hideAllScreens();
    document.getElementById('inventoryScreen')!.style.display = '';
    try {
      inventoryCache = await DB.getInventory() as InventoryItem[];
    } catch (e) {
      console.error('[Inventory] Veri yüklenemedi:', e);
    }
    renderInventoryTable();
  });
}

function getInventoryStatus(item: InventoryItem): string {
  if (item.stock_quantity <= 0) return 'out';
  if (item.stock_quantity <= item.min_stock_level) return 'low';
  return 'ok';
}

function renderInventoryKPIs(): void {
  const total = inventoryCache.length;
  const ok    = inventoryCache.filter(iv => iv.stock_quantity > iv.min_stock_level).length;
  const low   = inventoryCache.filter(iv => iv.stock_quantity > 0 && iv.stock_quantity <= iv.min_stock_level).length;
  const out   = inventoryCache.filter(iv => iv.stock_quantity <= 0).length;
  const el = (id: string, v: number | string) => { const e = document.getElementById(id); if (e) e.textContent = String(v); };
  el('invKpiTotal', total);
  el('invKpiOk',    ok);
  el('invKpiLow',   low);
  el('invKpiOut',   out);
}

function renderInventoryTable(): void {
  renderInventoryKPIs();
  const tbody = document.getElementById('inventoryTableBody')!;
  const filtered = invSearchQuery.trim()
    ? inventoryCache.filter(iv => iv.product_name.toLowerCase().includes(invSearchQuery.toLowerCase()) || iv.category.toLowerCase().includes(invSearchQuery.toLowerCase()))
    : inventoryCache;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="inv-empty"><svg width="36" height="36" viewBox="0 0 48 48" fill="none"><rect x="8" y="10" width="32" height="30" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.4"/><path d="M16 20h16M16 27h10" stroke="currentColor" stroke-width="1.5" opacity="0.4"/></svg><p>' + (invSearchQuery ? 'Sonuç bulunamadı' : 'Henüz stok kaydı yok') + '</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = '';
  filtered.forEach((item, idx) => {
    const status = getInventoryStatus(item);
    const statusLabel = status === 'out' ? 'Tükendi' : status === 'low' ? 'Az Kaldı' : 'Stokta';
    const statusClass = status === 'out' ? 'inv-status--out' : status === 'low' ? 'inv-status--low' : 'inv-status--ok';
    const menuItem = MENU.find(m => m.name === item.product_name);
    const icon = menuItem ? menuItem.icon : '📦';
    const catLabels: Record<string, string> = { hot: 'Sıcak İçecek', cold: 'Soğuk İçecek', special: 'Özel İçecek', dessert: 'Tatlı', addon: 'Ekstra' };
    const catLabel = catLabels[item.category] || item.category;
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="col-inv-num">' + (idx + 1) + '</td>' +
      '<td class="col-inv-name"><span class="inv-product-icon">' + icon + '</span>' + item.product_name + '</td>' +
      '<td class="col-inv-stock"><span class="inv-qty-display' + (status === 'out' ? ' inv-qty--zero' : status === 'low' ? ' inv-qty--low' : '') + '">' + item.stock_quantity + '</span></td>' +
      '<td class="col-inv-status"><span class="inv-status-badge ' + statusClass + '">' + statusLabel + '</span></td>' +
      '<td class="col-inv-cat"><span class="inv-cat-badge">' + catLabel + '</span></td>' +
      '<td class="col-inv-actions"><button class="inv-update-btn" data-name="' + item.product_name + '">Stok Güncelle</button></td>';
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.inv-update-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openUpdateStockModal((btn as HTMLElement).dataset.name!);
    });
  });
}

function openUpdateStockModal(productName: string): void {
  invModalMode = 'edit';
  invEditingProduct = productName;
  const item = inventoryCache.find(iv => iv.product_name === productName);
  const menuItem = MENU.find(m => m.name === productName);
  document.getElementById('invModalTitle')!.textContent = (menuItem ? menuItem.icon + ' ' : '') + productName;
  const qtyInput = document.getElementById('invModalQty') as HTMLInputElement;
  const minInput = document.getElementById('invModalMin') as HTMLInputElement;
  qtyInput.value = item ? String(item.stock_quantity) : '0';
  minInput.value = item ? String(item.min_stock_level) : '5';
  document.getElementById('invModalQtyLabel')!.textContent = 'Mevcut Stok (Kesin Değer)';
  document.getElementById('invModalNameRow')!.style.display = 'none';
  document.getElementById('invModalCatRow')!.style.display = 'none';
  document.getElementById('invModalMinRow')!.style.display = '';
  document.getElementById('invModalError')!.textContent = '';
  document.getElementById('invModalOverlay')!.style.display = 'flex';
  setTimeout(() => qtyInput.focus(), 80);
}

function openAddStockModal(): void {
  invModalMode = 'add';
  invEditingProduct = '';
  document.getElementById('invModalTitle')!.textContent = 'Stok Ekle';
  const nameInput = document.getElementById('invModalNameInput') as HTMLInputElement;
  const catInput  = document.getElementById('invModalCatInput')  as HTMLInputElement;
  const qtyInput  = document.getElementById('invModalQty')       as HTMLInputElement;
  nameInput.value = '';
  catInput.value  = '';
  qtyInput.value  = '1';
  document.getElementById('invModalQtyLabel')!.textContent = 'Eklenecek Miktar';
  document.getElementById('invModalNameRow')!.style.display = '';
  document.getElementById('invModalCatRow')!.style.display  = '';
  document.getElementById('invModalMinRow')!.style.display  = 'none';
  document.getElementById('invModalError')!.textContent = '';
  document.getElementById('invModalOverlay')!.style.display = 'flex';
  setTimeout(() => nameInput.focus(), 80);
}

function closeUpdateStockModal(): void {
  document.getElementById('invModalOverlay')!.style.display = 'none';
  invEditingProduct = '';
}

async function saveUpdateStock(): Promise<void> {
  const qtyInput = document.getElementById('invModalQty') as HTMLInputElement;
  const errEl    = document.getElementById('invModalError')!;
  const qty = parseInt(qtyInput.value, 10);
  if (isNaN(qty) || qty < 0) { errEl.textContent = 'Geçerli bir miktar girin (≥ 0).'; return; }

  if (invModalMode === 'add') {
    const nameInput = document.getElementById('invModalNameInput') as HTMLInputElement;
    const catInput  = document.getElementById('invModalCatInput')  as HTMLInputElement;
    const typedName = nameInput.value.trim();
    if (!typedName) { errEl.textContent = 'Ürün adı boş olamaz.'; return; }
    if (qty <= 0) { errEl.textContent = 'Eklenecek miktar en az 1 olmalı.'; return; }
    // Case-insensitive match: if name matches a MENU item, use its exact name for DB consistency
    const menuItem = MENU.find(m => m.name.toLowerCase() === typedName.toLowerCase());
    const productName = menuItem ? menuItem.name : typedName;
    const category = menuItem ? menuItem.cat : (catInput.value.trim() || 'other');
    try {
      await DB.addStock(productName, qty, category);
      inventoryCache = await DB.getInventory() as InventoryItem[];
      renderInventoryTable();
      renderProducts();
      closeUpdateStockModal();
      logActivity('order_clear' as ActionType, activeUser + ' stok ekledi: ' + productName + ' +' + qty + ' adet');
    } catch (err) {
      errEl.textContent = 'İşlem başarısız: ' + (err as Error).message;
    }
  } else {
    if (!invEditingProduct) return;
    const minInput = document.getElementById('invModalMin') as HTMLInputElement;
    const min = parseInt(minInput.value, 10);
    if (isNaN(min) || min < 0) { errEl.textContent = 'Geçerli bir minimum seviye girin (≥ 0).'; return; }
    const menuItem = MENU.find(m => m.name === invEditingProduct);
    const category = menuItem ? menuItem.cat : 'dessert';
    try {
      await DB.upsertInventory(invEditingProduct, qty, min, category);
      inventoryCache = await DB.getInventory() as InventoryItem[];
      renderInventoryTable();
      renderProducts();
      closeUpdateStockModal();
      logActivity('order_clear' as ActionType, activeUser + ' stok düzeltti: ' + invEditingProduct + ' → ' + qty + ' adet (min: ' + min + ')');
    } catch (err) {
      errEl.textContent = 'Güncelleme başarısız: ' + (err as Error).message;
    }
  }
}

function computeRelativeCutoff(n: number, unit: string): Date {
  const cutoff = new Date();
  if      (unit === 'gün')   cutoff.setDate(cutoff.getDate() - n);
  else if (unit === 'hafta') cutoff.setDate(cutoff.getDate() - n * 7);
  else if (unit === 'ay')    cutoff.setMonth(cutoff.getMonth() - n);
  else if (unit === 'yıl')   cutoff.setFullYear(cutoff.getFullYear() - n);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

function relativeFilterLabel(n: number, unit: string): string {
  const display: Record<string, string> = { gün: 'Gün', hafta: 'Hafta', ay: 'Ay', yıl: 'Yıl' };
  return 'Son ' + n + ' ' + (display[unit] || unit);
}

function computeRelativeTimePoints(n: number, unit: string, filtered: SaleRecord[]): TimePoint[] {
  const cutoff = computeRelativeCutoff(n, unit);
  const now = new Date();
  const spanDays = Math.ceil((now.getTime() - cutoff.getTime()) / 86400000);
  if (spanDays <= 60) {
    const points: TimePoint[] = [];
    const d = new Date(cutoff);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    while (d <= todayEnd) {
      const yr = d.getFullYear(), mo = d.getMonth(), dy = d.getDate();
      const recs = filtered.filter(s => { const sd = new Date(s.datetime); return sd.getFullYear() === yr && sd.getMonth() === mo && sd.getDate() === dy; });
      points.push({ label: d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }), revenue: recs.reduce((s, r) => s + r.total, 0), orders: recs.length });
      d.setDate(d.getDate() + 1);
    }
    return points;
  } else {
    const points: TimePoint[] = [];
    const m = new Date(cutoff.getFullYear(), cutoff.getMonth(), 1);
    const endM = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    while (m < endM) {
      const yr = m.getFullYear(), mo = m.getMonth();
      const recs = filtered.filter(s => { const sd = new Date(s.datetime); return sd.getFullYear() === yr && sd.getMonth() === mo; });
      points.push({ label: m.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }), revenue: recs.reduce((s, r) => s + r.total, 0), orders: recs.length });
      m.setMonth(m.getMonth() + 1);
    }
    return points;
  }
}

function filterProductSalesHistory(history: SaleRecord[], period: string, day: string | null, month?: string | null): SaleRecord[] {
  const now = new Date();
  if (productSalesRelativeN !== null && productSalesRelativeUnit !== null) {
    const cutoff = computeRelativeCutoff(productSalesRelativeN, productSalesRelativeUnit);
    return history.filter(o => new Date(o.datetime) >= cutoff);
  }
  if (day) {
    const [y, mo, d] = day.split('-').map(Number);
    const s = new Date(y, mo - 1, d), e = new Date(y, mo - 1, d + 1);
    return history.filter(o => { const dt = new Date(o.datetime); return dt >= s && dt < e; });
  }
  if (month) {
    const [y, mo] = month.split('-').map(Number);
    const s = new Date(y, mo - 1, 1), e = new Date(y, mo, 1);
    return history.filter(o => { const dt = new Date(o.datetime); return dt >= s && dt < e; });
  }
  if (period === 'daily') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return history.filter(o => new Date(o.datetime) >= s);
  }
  if (period === 'weekly') {
    const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0);
    return history.filter(o => new Date(o.datetime) >= s);
  }
  if (period === 'monthly') {
    // Current calendar month (1st of month → now)
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    return history.filter(o => new Date(o.datetime) >= s);
  }
  if (period === 'yearly') {
    const s = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return history.filter(o => new Date(o.datetime) >= s);
  }
  return history; // alltime
}

interface ProductSalesRow {
  name: string; icon: string; category: string;
  qty: number; unitPrice: number; totalRevenue: number;
  isCombo: boolean; // true = product+extras combination, false = standalone
}

interface CatalogEntry {
  name: string; icon: string; category: string; catalogPrice: number;
}

function computeProductSales(history: SaleRecord[], period: string, day: string | null, month?: string | null): ProductSalesRow[] {
  const filtered = filterProductSalesHistory(history, period, day, month);
  const CAT_TR: Record<string, string> = {
    hot: 'Sıcak İçecek', cold: 'Soğuk İçecek', special: 'Özel İçecek', dessert: 'Tatlı', addon: 'Eklenti',
  };

  // ── 1. Build zero-sales baseline (base/standalone products only) ──
  const catalogMap = new Map<string, CatalogEntry>();
  for (const item of MENU)
    catalogMap.set(item.name, { name: item.name, icon: item.icon, category: CAT_TR[item.cat] || item.cat, catalogPrice: item.price });
  for (const ex of EXTRAS)
    if (!catalogMap.has(ex.name))
      catalogMap.set(ex.name, { name: ex.name, icon: '☕', category: 'Kahve Ekstrası', catalogPrice: ex.price });
  for (const ex of DESSERT_EXTRAS)
    if (!catalogMap.has(ex.name))
      catalogMap.set(ex.name, { name: ex.name, icon: '🍰', category: 'Tatlı Ekstrası', catalogPrice: ex.price });

  // Rows map: key -> mutable row (includes both base rows and combo rows)
  const rowsMap = new Map<string, ProductSalesRow & { _mutable: true }>();
  // Initialize all catalog items as zero-sales base rows
  for (const [key, cat] of catalogMap) {
    rowsMap.set(key, {
      name: cat.name, icon: cat.icon, category: cat.category,
      unitPrice: cat.catalogPrice, qty: 0, totalRevenue: 0, isCombo: false, _mutable: true,
    });
  }

  // ── 2. Process sales ──────────────────────────────────────────────
  for (const sale of filtered) {
    for (const item of sale.items) {
      const hasExtras = item.extras.length > 0;

      if (!hasExtras) {
        // ── Plain product or standalone addon ──
        if (!rowsMap.has(item.name)) {
          // Unknown product (old data not in current catalog)
          rowsMap.set(item.name, {
            name: item.name, icon: item.icon, category: 'Diğer',
            unitPrice: item.unitPrice, qty: 0, totalRevenue: 0, isCombo: false, _mutable: true,
          });
        }
        const row = rowsMap.get(item.name)!;
        row.qty          += item.qty;
        row.totalRevenue += item.lineTotal;
      } else {
        // ── Combination row: ProductName + Extra1 + Extra2 … ──
        // Sort extras so 'Flat White + Ekstra Shot + Yulaf Sütü' is always the same key
        // regardless of the order extras were added in the cart.
        const sortedExtras  = [...item.extras].sort();
        const comboKey      = item.name + ' + ' + sortedExtras.join(' + ');
        const comboDisplay  = item.name + ' + ' + sortedExtras.join(' + ');

        if (!rowsMap.has(comboKey)) {
          // Inherit icon & category from the base product if it exists
          const base = catalogMap.get(item.name);
          rowsMap.set(comboKey, {
            name: comboDisplay,
            icon:     base ? base.icon     : item.icon,
            category: base ? base.category : 'Diğer',
            unitPrice: item.unitPrice,   // actual price paid (base + extras)
            qty: 0, totalRevenue: 0, isCombo: true, _mutable: true,
          });
        }
        const comboRow = rowsMap.get(comboKey)!;
        comboRow.qty          += item.qty;
        comboRow.totalRevenue += item.lineTotal;
      }
    }
  }

  return Array.from(rowsMap.values()) as unknown as ProductSalesRow[];
}

function renderProductSalesTable(): void {
  const tbody     = document.getElementById('productSalesTableBody')!;
  const summaryEl = document.getElementById('productSalesSummary');
  let rows = computeProductSales(productSalesHistory, productSalesPeriod, productSalesDay, productSalesMonth);

  // Search filter
  const q = productSalesSearchQ.trim().toLocaleLowerCase('tr-TR');
  if (q) rows = rows.filter(r => r.name.toLocaleLowerCase('tr-TR').includes(q) || r.category.toLocaleLowerCase('tr-TR').includes(q));

  // Sort: primary = qty (desc/asc), secondary = name asc (ties), zero-sales always last
  rows.sort((a, b) => {
    if (a.qty === 0 && b.qty === 0) return a.name.localeCompare(b.name, 'tr');
    if (a.qty === 0) return 1;
    if (b.qty === 0) return -1;
    const diff = productSalesSortAsc ? a.qty - b.qty : b.qty - a.qty;
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'tr');
  });

  const sortIcon = document.getElementById('productSalesSortIcon');
  if (sortIcon) sortIcon.textContent = productSalesSortAsc ? '↑' : '↓';

  // ── KPI Summary ────────────────────────────────────────────────
  // Use order.total (same source as Analytics) so both modules always agree.
  // row.totalRevenue sums item.lineTotal (pre-discount subtotals) which diverges
  // from order.total whenever a discount or tax adjustment is applied.
  const filteredForSplit = filterProductSalesHistory(productSalesHistory, productSalesPeriod, productSalesDay, productSalesMonth);
  const totalVariations = rows.filter(r => r.qty > 0).length;
  const totalQty        = rows.reduce((s, r) => s + r.qty, 0);
  const totalRevenue    = filteredForSplit.reduce((sum, o) => sum + o.total, 0);
  const { cash: psCash, card: psCard } = cashCardSplit(filteredForSplit);
  if (summaryEl) {
    summaryEl.innerHTML =
      '<div class="ps-kpi">'
        + '<span class="ps-kpi-value">' + totalVariations + '</span>'
        + '<span class="ps-kpi-label">Ürün Çeşidi</span>'
      + '</div>'
      + '<div class="ps-kpi">'
        + '<span class="ps-kpi-value">' + totalQty.toLocaleString('tr-TR') + '</span>'
        + '<span class="ps-kpi-label">Adet Satış</span>'
      + '</div>'
      + '<div class="ps-kpi ps-kpi--revenue">'
        + '<span class="ps-kpi-label">Toplam Ciro</span>'
        + '<span class="ps-kpi-value">₺' + totalRevenue.toLocaleString('tr-TR') + '</span>'
        + '<div class="ps-kpi-split">'
          + '<span class="split-cash">Nakit: ₺' + psCash.toLocaleString('tr-TR') + '</span>'
          + '<span class="split-sep">|</span>'
          + '<span class="split-card">Kart: ₺' + psCard.toLocaleString('tr-TR') + '</span>'
        + '</div>'
      + '</div>';
  }

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="ps-empty">'
      + '<svg width="36" height="36" viewBox="0 0 48 48" fill="none"><rect x="4" y="10" width="40" height="30" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.4"/><path d="M4 18h40" stroke="currentColor" stroke-width="1.5" opacity="0.4"/><path d="M14 26h20M14 32h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/></svg>'
      + '<p>' + (q ? 'Arama sonucu bulunamadı' : 'Bu dönem için satış verisi yok') + '</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r, i) => {
    const isTop  = i === 0 && !productSalesSortAsc && r.qty > 0;
    const isZero = r.qty === 0;
    const rowClass = ' ps-row' + (isTop ? ' ps-row--top' : '') + (isZero ? ' ps-row--zero' : '') + (r.isCombo ? ' ps-row--combo' : '');

    // Format name: for combos, highlight the '+' separator
    const displayName = r.isCombo
      ? escapeHtml(r.name).replace(/\s\+\s/g, ' <span class="ps-combo-sep">+</span> ')
      : escapeHtml(r.name);

    return '<tr class="' + rowClass.trim() + '">'
      + '<td class="col-ps-num">' + (i + 1) + '</td>'
      + '<td class="col-ps-name">'
          + '<span class="ps-icon">' + r.icon + '</span>'
          + displayName
      + '</td>'
      + '<td class="col-ps-cat"><span class="ps-cat-badge">' + escapeHtml(r.category) + '</span></td>'
      + '<td class="col-ps-qty">' + (r.qty > 0 ? '<strong>' + r.qty + '</strong> adet' : '<span class="ps-zero">0</span>') + '</td>'
      + '<td class="col-ps-price">₺' + r.unitPrice.toLocaleString('tr-TR') + '</td>'
      + '<td class="col-ps-revenue">' + (r.totalRevenue > 0 ? '<strong>₺' + r.totalRevenue.toLocaleString('tr-TR') + '</strong>' : '<span class="ps-zero">₺0</span>') + '</td>'
      + '</tr>';
  }).join('');
}

async function exportProductSalesPDF(): Promise<void> {
  const btn = document.getElementById('exportProductSalesPdfBtn')! as HTMLButtonElement;
  const origContent = btn.innerHTML;
  btn.innerHTML = 'Hazırlanıyor...';
  btn.disabled = true;
  try {
    const rows = computeProductSales(productSalesHistory, productSalesPeriod, productSalesDay, productSalesMonth);
    // PDF: active rows sorted by qty desc, zero-sales rows at bottom
    rows.sort((a, b) => {
      if (a.qty === 0 && b.qty === 0) return a.name.localeCompare(b.name, 'tr');
      if (a.qty === 0) return 1;
      if (b.qty === 0) return -1;
      return b.qty - a.qty;
    });
    const now      = new Date();
    const nowStr   = now.toLocaleDateString('tr-TR') + ' ' + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const fileDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    let periodLabel: string;
    if (productSalesRelativeN !== null && productSalesRelativeUnit !== null) {
      periodLabel = relativeFilterLabel(productSalesRelativeN, productSalesRelativeUnit);
    } else if (productSalesDay) {
      const [y, mo, d] = productSalesDay.split('-').map(Number);
      periodLabel = new Date(y, mo - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (productSalesMonth) {
      const [y, mo] = productSalesMonth.split('-').map(Number);
      const monthStr = new Date(y, mo - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
      periodLabel = monthStr + ' / Aylık';
    } else {
      const lm: Record<string, string> = { daily: 'Bugün', weekly: 'Son 7 Gün', monthly: 'Bu Ay', yearly: 'Son 12 Ay', alltime: 'Tüm Zamanlar' };
      periodLabel = lm[productSalesPeriod] || productSalesPeriod;
    }
    const pdfFiltered  = filterProductSalesHistory(productSalesHistory, productSalesPeriod, productSalesDay, productSalesMonth);
    const totalQty     = rows.reduce((s, r) => s + r.qty, 0);
    // Use order.total (same source as Analytics) for exact match across modules
    const totalRevenue = pdfFiltered.reduce((sum, o) => sum + o.total, 0);
    const { cash: pdfCash, card: pdfCard } = cashCardSplit(pdfFiltered);
    const tableRows    = rows.map((r, i) =>
      '<tr' + (r.qty === 0 ? ' style="color:#94a3b8"' : (r.isCombo ? ' style="background:#f0f9ff"' : '')) + '>'
      + '<td>' + (i + 1) + '</td>'
      + '<td>' + r.icon + ' ' + r.name + '</td>'
      + '<td>' + r.category + '</td>'
      + '<td class="right">' + (r.qty > 0 ? '<strong>' + r.qty + ' adet</strong>' : '0') + '</td>'
      + '<td class="right">₺' + r.unitPrice.toLocaleString('tr-TR') + '</td>'
      + '<td class="right bold">₺' + r.totalRevenue.toLocaleString('tr-TR') + '</td>'
      + '</tr>'
    ).join('');

    const fullHtml = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  @page{size:A4 portrait;margin:10mm}
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1e293b;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .header{background:#0f172a;color:#fff;padding:18px 24px 14px}
  .header-title{font-size:17px;font-weight:800;letter-spacing:-.2px;margin-bottom:6px}
  .header-meta{font-size:11px;color:#94a3b8;line-height:1.8}
  .header-meta strong{color:#e2e8f0}
  .accent-bar{height:4px;background:#0ea5e9;margin-bottom:18px}
  .stats-row{display:flex;gap:12px;margin-bottom:18px}
  .stat-card{flex:1;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;padding:12px 14px}
  .stat-card.blue{border-top:4px solid #0ea5e9}.stat-card.green{border-top:4px solid #16a34a}
  .stat-label{font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  .stat-value{font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-.5px;line-height:1}
  .stat-split{margin-top:5px;font-size:10px;font-weight:600;color:#64748b}
  .stat-split .sc{color:#16a34a}.stat-split .sk{color:#2563eb}
  .section-title{font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.09em;padding-bottom:7px;border-bottom:2px solid #e2e8f0;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:11.5px}
  thead{display:table-row-group}
  thead tr{background:#f1f5f9}
  th{text-align:left;padding:9px 10px;font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.07em;border-bottom:2px solid #cbd5e1}
  th.right,td.right{text-align:right}
  td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
  td.bold{font-weight:700}
  tr{page-break-inside:avoid}
  .footer{margin-top:14px;padding-top:10px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#94a3b8}
</style></head><body>
  <div class="header">
    <div class="header-title">☕ ÜRÜN BAZLI SATIŞ RAPORU</div>
    <div class="header-meta">FİLTRE: <strong>${periodLabel}</strong> &nbsp;&nbsp;|&nbsp;&nbsp; TARİH: <strong>${nowStr}</strong></div>
  </div>
  <div class="accent-bar"></div>
  <div class="stats-row">
    <div class="stat-card blue"><div class="stat-label">Toplam Satış Adedi</div><div class="stat-value">${totalQty}</div></div>
    <div class="stat-card green"><div class="stat-label">Toplam Ciro</div><div class="stat-value">₺${totalRevenue.toLocaleString('tr-TR')}</div><div class="stat-split"><span class="sc">Nakit: ₺${pdfCash.toLocaleString('tr-TR')}</span> &nbsp;|&nbsp; <span class="sk">Kart: ₺${pdfCard.toLocaleString('tr-TR')}</span></div></div>
    <div class="stat-card blue"><div class="stat-label">Ürün Çeşidi</div><div class="stat-value">${rows.filter(r => r.qty > 0).length}</div></div>
  </div>
  <div class="section-title">📋 ÜRÜN BAZLI DETAY</div>
  <table>
    <thead><tr><th>#</th><th>Ürün Adı</th><th>Kategori</th><th class="right">Satış Adedi</th><th class="right">Birim Fiyat</th><th class="right">Toplam Ciro</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">Coffee Shop POS &bull; ${nowStr} tarihinde oluşturuldu</div>
</body></html>`;

    const posDB = window.posDB;
    const res   = await (posDB as unknown as { exportPDF: (html: string) => Promise<{ ok: boolean; reason?: string }> }).exportPDF(fullHtml);
    if (res.ok) {
      btn.innerHTML = '✓ Kaydedildi';
      setTimeout(() => { btn.innerHTML = origContent; btn.disabled = false; }, 2500);
      return;
    } else if (res.reason !== 'canceled') {
      alert('PDF oluşturulurken hata: ' + (res.reason ?? 'bilinmiyor'));
    }
  } catch (err) {
    console.error('[PDF] Ürün Satış PDF hatası:', err);
    alert('PDF oluşturulurken beklenmeyen hata oluştu.');
  } finally {
    btn.innerHTML = origContent;
    btn.disabled  = false;
  }
}

// ── AKTİVİTE LOGLAMA ──────────────────────────

function logActivity(actionType: ActionType, description: string, details?: string | null): void {
  const user     = staffList.find(u => u.username === activeUser);
  const userId   = user ? user.id : 0;
  const username = activeUser || 'system';

  const posDB = window.posDB;
  if (!posDB || typeof (posDB as unknown as Record<string, unknown>)['addActivityLog'] !== 'function') {
    console.error('[LOG] window.posDB.addActivityLog bulunamadı — preload bağlantısı kopuk olabilir. actionType:', actionType);
    return;
  }

  (posDB as unknown as { addActivityLog: (uid: number, uname: string, at: string, desc: string, det?: string | null) => Promise<boolean> })
    .addActivityLog(userId, username, actionType, description, details ?? null)
    .then(result => {
      if (!result) {
        console.error('[LOG] addActivityLog false döndü (DB yazma başarısız). actionType:', actionType, '| description:', description);
      }
    })
    .catch((err: unknown) => {
      console.error('[LOG] addActivityLog IPC hatası. actionType:', actionType, '| Hata:', err);
    });
}

// ── İŞLEM KAYITLARI YÖNETİMİ ─────────────────

async function loadAndRenderLogs(): Promise<void> {
  try {
    activityLogs = await DB.getActivityLogs();
  } catch (e) {
    console.error('[Logs] getActivityLogs hatası:', e);
  }
  renderLogs();
}

const LOG_LABELS: Record<string, string> = {
  auth_login:                '🔑 Giriş',
  auth_logout:               '🚪 Çıkış',
  order_payment:             '💳 Ödeme',
  order_discounted_payment:  '🏷 İndirimli Ödeme',
  order_kitchen:     '📋 Sipariş',
  order_receipt:     '🖨 Fiş',
  order_clear:       '🗑 Sipariş Sil',
  staff_add:         '➕ Personel',
  staff_update:      '✏ Personel',
  staff_delete:      '🗑 Personel',
};

/** Parse a SQLite timestamp ("YYYY-MM-DD HH:MM:SS") into milliseconds. */
function parseLogTs(ts: string): number {
  // Replace the space separator with T so all JS engines treat it as local time.
  return new Date(ts.replace(' ', 'T')).getTime();
}

/** Format a SQLite timestamp as "DD.MM.YYYY HH:mm" for display. */
function formatLogTs(ts: string): string {
  const d = new Date(ts.replace(' ', 'T'));
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  );
}

function buildLogSearchBundle(log: ActivityLog): string {
  const rawDate = new Date(log.timestamp);
  const trDate  = rawDate.toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const trTime  = rawDate.toLocaleTimeString('tr-TR', {
    hour: '2-digit', minute: '2-digit',
  });
  const label   = LOG_LABELS[log.action_type] || log.action_type;
  return [
    log.timestamp,
    trDate,
    trTime,
    log.username,
    label,
    log.action_type,
    log.description,
    log.details ?? '',
  ].join(' ').toLocaleLowerCase('tr-TR');
}

function renderLogs(): void {
  const tbody = document.getElementById('logsTableBody')!;
  const q     = logsSearchQuery.trim().toLocaleLowerCase('tr-TR');

  const list = activityLogs.filter(l =>
    !q || buildLogSearchBundle(l).includes(q)
  );

  const hasFilter = !!q;

  if (list.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5">' +
        '<div class="logs-empty">' +
          '<svg width="36" height="36" viewBox="0 0 48 48" fill="none">' +
            '<rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>' +
            '<path d="M15 16h18M15 23h18M15 30h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>' +
          '</svg>' +
          '<p>' + (hasFilter ? 'Arama sonucu bulunamadı' : 'Henüz işlem kaydı yok') + '</p>' +
        '</div>' +
      '</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(l => {
    const label      = LOG_LABELS[l.action_type] || l.action_type;
    const badgeClass = 'log-type-badge log-type-badge--' + l.action_type.toLowerCase();
    const hasDetails = !!l.details;

    const chevronBtn = hasDetails
      ? '<button class="log-expand-btn" data-id="' + l.id + '" title="Detayları Göster/Gizle">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none">' +
            '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
        '</button>'
      : '';

    const detailItems = hasDetails
      ? l.details!.split('\n').map(line =>
          '<div class="log-acc-item">' + escapeHtml(line.trim()) + '</div>'
        ).join('')
      : '';

    const mainRow =
      '<tr class="log-main-row" data-id="' + l.id + '">' +
      '<td class="col-log-time">'  + escapeHtml(formatLogTs(l.timestamp)) + '</td>' +
      '<td class="col-log-user"><strong>' + escapeHtml(l.username) + '</strong></td>' +
      '<td class="col-log-type"><span class="' + badgeClass + '">' + label + '</span></td>' +
      '<td class="col-log-desc">'  + escapeHtml(l.description) + '</td>' +
      '<td class="col-log-actions">' +
        '<div class="log-actions-wrap">' +
          chevronBtn +
          '<button class="log-delete-btn" data-id="' + l.id + '" title="Kaydı Sil">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
              '<polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
              '<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</td>' +
      '</tr>';

    const detailRow = hasDetails
      ? '<tr class="log-detail-row" data-for="' + l.id + '">' +
          '<td colspan="5" class="log-detail-cell">' +
            '<div class="log-expand-body">' +
              '<div class="log-expand-content">' + detailItems + '</div>' +
            '</div>' +
          '</td>' +
        '</tr>'
      : '';

    return mainRow + detailRow;
  }).join('');

  tbody.querySelectorAll('.log-delete-btn').forEach(btn => {
    (btn as HTMLButtonElement).addEventListener('click', () => {
      const id = parseInt((btn as HTMLButtonElement).dataset.id!, 10);
      confirmDeleteLog(id);
    });
  });

  tbody.querySelectorAll('.log-expand-btn').forEach(btn => {
    (btn as HTMLButtonElement).addEventListener('click', () => {
      const id       = (btn as HTMLButtonElement).dataset.id!;
      const mainRow  = tbody.querySelector('.log-main-row[data-id="' + id + '"]')!;
      const detRow   = tbody.querySelector('.log-detail-row[data-for="' + id + '"]')!;
      const expanded = mainRow.classList.toggle('expanded');
      detRow.classList.toggle('expanded', expanded);
    });
  });
}

async function confirmDeleteLog(id: number): Promise<void> {
  const ok = await showConfirm(
    'Kaydı Sil',
    'Bu işlem kaydını kalıcı olarak silmek istediğinize emin misiniz?',
    'Evet, Sil', 'İptal', 'danger',
  );
  if (!ok) return;
  await DB.deleteActivityLog(id);
  await loadAndRenderLogs();
}

async function confirmClearAllLogs(): Promise<void> {
  const ok = await showConfirm(
    'Tüm Kayıtları Temizle',
    'Tüm işlem kayıtlarını kalıcı olarak silmek istediğinize emin misiniz?\n\nBu işlem geri alınamaz.',
    'Tümünü Sil', 'İptal', 'danger',
  );
  if (!ok) return;
  await DB.clearActivityLogs();
  activityLogs = [];
  renderLogs();
}

// ── ANALİTİK: VERİ HESAPLAMA ─────────────────

function updateAnalyticsFilterState(): void {
  document.getElementById('analyticsMonthFilter')!.classList.toggle('is-active', !!analyticsMonth);
  document.getElementById('analyticsDayFilter')!.classList.toggle('is-active',   !!analyticsDay);
  const isRelActive = analyticsRelativeN !== null;
  document.getElementById('analyticsRelativeWrap')!.classList.toggle('is-active', isRelActive);
  document.getElementById('analyticsRelativeApply')!.classList.toggle('is-active', isRelActive);
}

function updateProductSalesFilterState(): void {
  document.getElementById('productSalesMonthFilter')!.classList.toggle('is-active', !!productSalesMonth);
  document.getElementById('productSalesDayFilter')!.classList.toggle('is-active',   !!productSalesDay);
  const isRelActive = productSalesRelativeN !== null;
  document.getElementById('productSalesRelativeWrap')!.classList.toggle('is-active', isRelActive);
  document.getElementById('productSalesRelativeApply')!.classList.toggle('is-active', isRelActive);
}

function cashCardSplit(records: SaleRecord[]): { cash: number; card: number } {
  let cash = 0, card = 0;
  for (const s of records) {
    if (s.paymentType === 'cash')       cash += s.total;
    else if (s.paymentType === 'card')  card += s.total;
    else if (s.paymentType === 'split') { cash += s.cashAmount || 0; card += s.cardAmount || 0; }
  }
  return { cash, card };
}

function computeAnalytics(period: AnalyticsPeriod, history: SaleRecord[], month: string | null, day: string | null): AnalyticsResult {
  const now = new Date();

  let filtered: SaleRecord[];
  let timePoints: TimePoint[];

  if (analyticsRelativeN !== null && analyticsRelativeUnit !== null) {
    const cutoff = computeRelativeCutoff(analyticsRelativeN, analyticsRelativeUnit);
    filtered = history.filter(s => new Date(s.datetime) >= cutoff);
    timePoints = computeRelativeTimePoints(analyticsRelativeN, analyticsRelativeUnit, filtered);
  } else if (day) {
    const [y, mo, d] = day.split('-').map(Number);
    const dayStart = new Date(y, mo - 1, d);
    const dayEnd   = new Date(y, mo - 1, d + 1);
    filtered = history.filter(s => {
      const dt = new Date(s.datetime);
      return dt >= dayStart && dt < dayEnd;
    });
    timePoints = Array.from({ length: 24 }, (_, h) => {
      const hrs = filtered.filter(s => new Date(s.datetime).getHours() === h);
      return {
        label:   String(h).padStart(2, '0') + ':00',
        revenue: hrs.reduce((sum, s) => sum + s.total, 0),
        orders:  hrs.length,
      };
    });
  } else if (month) {
    const [y, mo] = month.split('-').map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    filtered = history.filter(s => {
      const d = new Date(s.datetime);
      return d.getFullYear() === y && d.getMonth() + 1 === mo;
    });
    timePoints = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const ds = filtered.filter(s => new Date(s.datetime).getDate() === day);
      return {
        label:   String(day),
        revenue: ds.reduce((sum, s) => sum + s.total, 0),
        orders:  ds.length,
      };
    });
  } else if (period === 'daily') {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    filtered = history.filter(s => new Date(s.datetime) >= todayStart);
    timePoints = Array.from({ length: 24 }, (_, h) => {
      const hrs = filtered.filter(s => new Date(s.datetime).getHours() === h);
      return {
        label:   String(h).padStart(2, '0') + ':00',
        revenue: hrs.reduce((sum, s) => sum + s.total, 0),
        orders:  hrs.length,
      };
    });
  } else if (period === 'weekly') {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now); d.setDate(d.getDate() - (6 - i)); return d;
    });
    const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 6); cutoff.setHours(0,0,0,0);
    filtered = history.filter(s => new Date(s.datetime) >= cutoff);
    timePoints = days.map(d => {
      const ds = filtered.filter(s => {
        const sd = new Date(s.datetime);
        return sd.getDate() === d.getDate() && sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear();
      });
      return {
        label:   d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' }),
        revenue: ds.reduce((sum, s) => sum + s.total, 0),
        orders:  ds.length,
      };
    });
  } else if (period === 'monthly') {
    // Current calendar month (1st of month → today)
    const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInCurMon  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    filtered = history.filter(s => new Date(s.datetime) >= monthStart);
    timePoints = Array.from({ length: daysInCurMon }, (_, i) => {
      const dayNum = i + 1;
      const ds = filtered.filter(s => {
        const sd = new Date(s.datetime);
        return sd.getDate() === dayNum && sd.getMonth() === now.getMonth() && sd.getFullYear() === now.getFullYear();
      });
      return {
        label:   String(dayNum),
        revenue: ds.reduce((sum, s) => sum + s.total, 0),
        orders:  ds.length,
      };
    });
  } else if (period === 'yearly') {
    const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    filtered = history.filter(s => new Date(s.datetime) >= cutoff);
    timePoints = months.map(d => {
      const ms = filtered.filter(s => {
        const sd = new Date(s.datetime);
        return sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear();
      });
      return {
        label:   d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }),
        revenue: ms.reduce((sum, s) => sum + s.total, 0),
        orders:  ms.length,
      };
    });
  } else { // alltime — all history grouped by calendar month
    filtered = history;
    const monthSet = new Set<string>();
    filtered.forEach(s => {
      const d = new Date(s.datetime);
      monthSet.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    });
    timePoints = [...monthSet].sort().map(m => {
      const [y, mo] = m.split('-').map(Number);
      const ms = filtered.filter(s => {
        const sd = new Date(s.datetime);
        return sd.getMonth() + 1 === mo && sd.getFullYear() === y;
      });
      return {
        label:   new Date(y, mo - 1, 1).toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' }),
        revenue: ms.reduce((sum, s) => sum + s.total, 0),
        orders:  ms.length,
      };
    });
  }

  const itemMap: Record<string, TopSeller> = {};
  filtered.forEach(sale => {
    sale.items.forEach(item => {
      if (!itemMap[item.name]) itemMap[item.name] = { name: item.name, icon: item.icon, qty: 0, revenue: 0 };
      itemMap[item.name].qty     += item.qty;
      itemMap[item.name].revenue += item.lineTotal;
    });
  });

  const allSellers = Object.values(itemMap).sort((a, b) => b.qty - a.qty);
  const topSellers    = allSellers.slice(0, 5);
  const lowPerformers = allSellers.length >= 5
    ? [...allSellers].sort((a, b) => a.qty - b.qty).slice(0, 5)
    : allSellers.length > 0
      ? [...allSellers].sort((a, b) => a.qty - b.qty)
      : [];

  const totalRevenue  = filtered.reduce((sum, s) => sum + s.total, 0);
  const totalOrders   = filtered.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  const { cash: cashRevenue, card: cardRevenue } = cashCardSplit(filtered);

  return { timePoints, topSellers, lowPerformers, totalRevenue, cashRevenue, cardRevenue, totalOrders, avgOrderValue };
}

// ── ANALİTİK: PDF YARDIMCI ─ Off-screen Chart.js → base64 PNG ──
//
// Mevcut canvas instance'larını KULLANMIYORUZ çünkü:
//   • Kullanıcı dark-mode'daysa renkler baskıya uygun değil
//   • responsive:true ile canvas boyutu 0 olabilir
// Bunun yerine sabit boyutlu temiz bir canvas oluşturuyor,
// Chart.js'i animation:false ile çizip hemen PNG alıyoruz.

async function renderChartForPDF(
  type: string,
  data: object,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraOptions: Record<string, any>,
  width: number,
  height: number,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Solid white background — critical for PDF transparency handling
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chart = new (window as any).Chart(ctx, {
    type,
    data,
    options: { ...extraOptions, animation: false, responsive: false },
  });
  // One rAF so Chart.js completes its synchronous draw pass
  await new Promise<void>(r => requestAnimationFrame(() => r()));
  const img = canvas.toDataURL('image/png', 1);
  chart.destroy();
  return img;
}

// ── ANALİTİK: PDF DIŞA AKTARMA ───────────────
//
// html2canvas/html2pdf KULLANILMIYOR.
// Electron'un yerleşik printToPDF() API'si kullanılıyor:
//   1. Temiz bir HTML belgesi oluştur (tüm veriler ve grafikler içinde)
//   2. Ana süreç IPC kanalı üzerinden gönder (db:exportPDF)
//   3. Main process gizli bir BrowserWindow açar, HTML'i yükler,
//      Chromium'un kendi PDF motoruyla A4'e basar — viewport/zoom/DPI sorunu olmaz.

async function exportAnalyticsPDF(): Promise<void> {
  const btn = document.getElementById('exportPdfBtn') as HTMLButtonElement;
  const origContent = btn.innerHTML;
  btn.innerHTML = 'Hazırlanıyor...';
  btn.disabled = true;

  try {
    // ── 1. Veri ──────────────────────────────────────────────────
    const result = computeAnalytics(analyticsPeriod, analyticsHistory, analyticsMonth, analyticsDay);

    // ── 2. Dönem etiketi ─────────────────────────────────────────
    let periodLabel: string;
    if (analyticsRelativeN !== null && analyticsRelativeUnit !== null) {
      periodLabel = relativeFilterLabel(analyticsRelativeN, analyticsRelativeUnit);
    } else if (analyticsDay) {
      const [y, mo, d] = analyticsDay.split('-').map(Number);
      periodLabel = new Date(y, mo - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (analyticsMonth) {
      const [y, mo] = analyticsMonth.split('-');
      const raw = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
      periodLabel = raw.charAt(0).toUpperCase() + raw.slice(1) + ' / Aylık';
    } else {
      const lm: Record<AnalyticsPeriod, string> = { daily: 'Bugün', weekly: 'Son 7 Gün', monthly: 'Bu Ay', yearly: 'Son 12 Ay', alltime: 'Tüm Zamanlar' };
      periodLabel = lm[analyticsPeriod] || analyticsPeriod;
    }

    const now      = new Date();
    const nowStr   = now.toLocaleDateString('tr-TR') + ' ' + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const fileDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    // ── 3. Grafik PNG'leri ────────────────────────────────────────
    // Off-screen canvas, animation:false, light-mode colours.
    // Portrait A4 (usable 190mm @ 96dpi ≈ 718px).
    // Landscape A4 (usable 277mm @ 96dpi ≈ 1047px) — auto-selected when
    // there are more than 15 data points so bars stay readable.
    const isLandscape = result.timePoints.length > 15;
    const CHART_W    = isLandscape ? 1020 : 718;
    const CHART_H_REV = 260;
    const LIGHT_TICK = '#475569';
    const LIGHT_GRID = 'rgba(0,0,0,0.07)';

    const revenueImg = result.timePoints.length > 0
      ? await renderChartForPDF(
          'bar',
          {
            labels: result.timePoints.map((t: { label: string }) => t.label),
            datasets: [{
              label: 'Ciro (TL)',
              data: result.timePoints.map((t: { revenue: number }) => t.revenue),
              backgroundColor: 'rgba(37,99,235,0.82)',
              borderColor: '#1d4ed8',
              borderWidth: 1,
              borderRadius: 5,
            }],
          },
          {
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: LIGHT_GRID }, ticks: { color: LIGHT_TICK, maxRotation: 45, font: { size: 11 } } },
              y: { grid: { color: LIGHT_GRID }, ticks: { color: LIGHT_TICK, callback: (v: number) => '₺' + v.toLocaleString('tr-TR') }, beginAtZero: true },
            },
          },
          CHART_W, CHART_H_REV,
        )
      : '';

    const topSellersImg = result.topSellers.length > 0
      ? await renderChartForPDF(
          'doughnut',
          {
            labels: result.topSellers.map((s: { name: string }) => s.name),
            datasets: [{
              data: result.topSellers.map((s: { qty: number }) => s.qty),
              backgroundColor: ['rgba(37,99,235,0.85)', 'rgba(22,163,74,0.85)', 'rgba(245,158,11,0.85)', 'rgba(239,68,68,0.85)', 'rgba(139,92,246,0.85)'],
              borderColor: '#ffffff',
              borderWidth: 3,
            }],
          },
          {
            cutout: '55%',
            plugins: {
              legend: { position: 'right', labels: { color: '#1e293b', font: { size: 12 }, boxWidth: 14, padding: 14 } },
              tooltip: { callbacks: { label: (ctx: { label: string; parsed: number }) => ' ' + ctx.label + ': ' + ctx.parsed + ' adet' } },
            },
          },
          CHART_W, 280,
        )
      : '';

    // ── 4. En Çok Satanlar tablo satırları ──────────────────────
    const topSellersRows = result.topSellers.map((p: { icon: string; name: string; qty: number; revenue: number }) =>
      '<tr>' +
        '<td>' + p.icon + ' ' + p.name + '</td>' +
        '<td class="right muted">' + p.qty + ' adet</td>' +
        '<td class="right bold">₺' + p.revenue.toLocaleString('tr-TR') + '</td>' +
      '</tr>'
    ).join('');

    // ── 5. Az Satanlar tablo satırları ───────────────────────────
    const lowRows = result.lowPerformers.map((p: { icon: string; name: string; qty: number; revenue: number }) =>
      '<tr>' +
        '<td>' + p.icon + ' ' + p.name + '</td>' +
        '<td class="right muted">' + p.qty + ' adet</td>' +
        '<td class="right bold">₺' + p.revenue.toLocaleString('tr-TR') + '</td>' +
      '</tr>'
    ).join('');

    // ── 5. Tam HTML belgesi ──────────────────────────────────────
    // Bu belge ayrı, izole bir BrowserWindow'da açılır.
    // CSS width:%100, @page margin:10mm → Chromium A4'e pixel-perfect basar.
    // Grafik görselleri zaten base64 PNG olduğundan render beklemeye gerek yok.
    const fullHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @page {
    size: A4 ${isLandscape ? 'landscape' : 'portrait'};
    margin: 10mm;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 13px;
    color: #1e293b;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── BAŞLIK ────────────────────────────────── */
  .header {
    background: #0f172a;
    color: #ffffff;
    padding: 20px 24px 16px;
    margin-bottom: 0;
  }
  .header-title {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -0.2px;
    margin-bottom: 8px;
    line-height: 1.2;
  }
  .header-meta {
    font-size: 11px;
    color: #94a3b8;
    line-height: 1.8;
  }
  .header-meta strong { color: #e2e8f0; }
  .accent-bar { height: 4px; background: #2563eb; margin-bottom: 20px; }

  /* ── İSTATİSTİK KARTLARI ────────────────────── */
  .stats-row {
    display: flex;
    gap: 14px;
    margin-bottom: 20px;
  }
  .stat-card {
    flex: 1;
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 16px;
    page-break-inside: avoid;
  }
  .stat-card.blue  { border-top: 4px solid #2563eb; }
  .stat-card.green { border-top: 4px solid #16a34a; }
  .stat-card.purple{ border-top: 4px solid #7c3aed; }
  .stat-label {
    font-size: 9px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: .08em;
    margin-bottom: 7px;
  }
  .stat-value {
    font-size: 26px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.5px;
    line-height: 1;
  }
  .stat-split {
    margin-top: 6px;
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
  }
  .stat-split .sc { color: #16a34a; }
  .stat-split .sk { color: #2563eb; }

  /* ── BÖLÜM BAŞLIKLARI ───────────────────────── */
  .section-title {
    font-size: 10px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: .09em;
    padding-bottom: 7px;
    border-bottom: 2px solid #e2e8f0;
    margin-bottom: 12px;
  }
  .section { margin-bottom: 20px; }
  .section.chart-section { page-break-inside: avoid; }

  /* ── GRAFİKLER ──────────────────────────────── */
  .chart-img {
    width: 100%;
    display: block;
    border-radius: 6px;
    border: 1px solid #e8edf2;
  }
  .doughnut-wrap {
    background: #f8fafc;
    border: 1px solid #e8edf2;
    border-radius: 8px;
    padding: 12px;
    text-align: center;
  }
  .doughnut-wrap img { max-height: 270px; }

  /* ── TABLO ──────────────────────────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  thead { display: table-row-group; }
  thead tr { background: #f1f5f9; }
  th {
    text-align: left;
    padding: 10px 14px;
    font-size: 9px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: .07em;
    border-bottom: 2px solid #cbd5e1;
  }
  th.right, td.right { text-align: right; }
  td {
    padding: 9px 14px;
    border-bottom: 1px solid #f1f5f9;
    color: #1e293b;
  }
  td.muted  { color: #64748b; }
  td.bold   { font-weight: 700; }
  tr { page-break-inside: avoid; }

  /* ── ALT BİLGİ ──────────────────────────────── */
  .footer {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    text-align: center;
    font-size: 10px;
    color: #94a3b8;
  }
</style>
</head>
<body>

  <div class="header">
    <div class="header-title">☕ COFFEE SHOP — SATIŞ ANALİZ RAPORU</div>
    <div class="header-meta">
      FİLTRE: <strong>${periodLabel}</strong>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      TARİH: <strong>${nowStr}</strong>
    </div>
  </div>
  <div class="accent-bar"></div>

  <!-- İstatistik Kartları -->
  <div class="stats-row">
    <div class="stat-card blue">
      <div class="stat-label">Toplam Ciro</div>
      <div class="stat-value">₺${result.totalRevenue.toLocaleString('tr-TR')}</div>
      <div class="stat-split"><span class="sc">Nakit: ₺${result.cashRevenue.toLocaleString('tr-TR')}</span> &nbsp;|&nbsp; <span class="sk">Kart: ₺${result.cardRevenue.toLocaleString('tr-TR')}</span></div>
    </div>
    <div class="stat-card green">
      <div class="stat-label">Toplam Sipariş</div>
      <div class="stat-value">${result.totalOrders}</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-label">Ort. Sipariş Değeri</div>
      <div class="stat-value">₺${result.avgOrderValue.toLocaleString('tr-TR')}</div>
    </div>
  </div>

  ${revenueImg ? `
  <!-- Gelir Grafiği -->
  <div class="section chart-section">
    <div class="section-title">📈 Gelir Grafiği</div>
    <img class="chart-img" src="${revenueImg}">
  </div>` : ''}

  ${topSellersImg ? `
  <!-- En Çok Satanlar — Pasta Grafik -->
  <div class="section chart-section">
    <div class="section-title">🥧 En Çok Satanlar</div>
    <div class="doughnut-wrap">
      <img src="${topSellersImg}">
    </div>
  </div>` : ''}

  ${result.topSellers.length > 0 ? `
  <!-- En Çok Satanlar — Tablo -->
  <div class="section">
    <div class="section-title">🏆 En Çok Satanlar</div>
    <table>
      <thead>
        <tr>
          <th>Ürün</th>
          <th class="right">Adet</th>
          <th class="right">Ciro</th>
        </tr>
      </thead>
      <tbody>${topSellersRows}</tbody>
    </table>
  </div>` : ''}

  ${result.lowPerformers.length > 0 ? `
  <!-- Az Satanlar -->
  <div class="section">
    <div class="section-title">📉 Az Satanlar</div>
    <table>
      <thead>
        <tr>
          <th>Ürün</th>
          <th class="right">Adet</th>
          <th class="right">Ciro</th>
        </tr>
      </thead>
      <tbody>${lowRows}</tbody>
    </table>
  </div>` : ''}

  <div class="footer">
    Coffee Shop POS &bull; ${nowStr} tarihinde oluşturuldu
  </div>

</body>
</html>`;

    // ── 6. Electron IPC ile PDF oluştur ──────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posDB = (window as any).posDB;
    const res = await posDB.exportPDF(fullHtml) as { ok: boolean; filePath?: string; reason?: string };
    if (res.ok) {
      // Başarı bildirimi
      btn.innerHTML = '✓ Kaydedildi';
      setTimeout(() => { btn.innerHTML = origContent; btn.disabled = false; }, 2500);
      return; // finally bloğu disabled=false yapmasın diye erken çık
    } else if (res.reason !== 'canceled') {
      alert('PDF oluşturulurken hata: ' + (res.reason ?? 'bilinmiyor'));
    }

  } catch (err) {
    console.error('[PDF] Dışa aktarma hatası:', err);
    alert('PDF oluşturulurken beklenmeyen hata oluştu.');
  } finally {
    btn.innerHTML = origContent;
    btn.disabled = false;
  }
}

// ── ANALİTİK: RENDER ──────────────────────────

function renderAnalyticsCharts(): void {
  const result  = computeAnalytics(analyticsPeriod, analyticsHistory, analyticsMonth, analyticsDay);
  const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridClr = isDark ? 'rgba(120,140,180,0.09)' : 'rgba(0,0,0,0.06)';
  const tickClr = isDark ? '#94a3b8' : '#64748b';

  // ── Stats ──
  const statsRow = document.getElementById('analyticsStatsRow')!;
  statsRow.innerHTML =
    '<div class="analytics-stat-card analytics-stat-card--revenue">' +
      '<div class="analytics-stat-label">Toplam Ciro</div>' +
      '<div class="analytics-stat-value">₺' + result.totalRevenue.toLocaleString('tr-TR') + '</div>' +
      '<div class="analytics-stat-split">' +
        '<span class="split-cash">Nakit: ₺' + result.cashRevenue.toLocaleString('tr-TR') + '</span>' +
        '<span class="split-sep">|</span>' +
        '<span class="split-card">Kart: ₺' + result.cardRevenue.toLocaleString('tr-TR') + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="analytics-stat-card">' +
      '<div class="analytics-stat-label">Toplam Sipariş</div>' +
      '<div class="analytics-stat-value">' + result.totalOrders + '</div>' +
    '</div>' +
    '<div class="analytics-stat-card">' +
      '<div class="analytics-stat-label">Ortalama Sipariş</div>' +
      '<div class="analytics-stat-value">₺' + result.avgOrderValue.toLocaleString('tr-TR') + '</div>' +
    '</div>';

  // ── Revenue Chart (dual-canvas: sticky Y-axis + scrollable bars) ──
  if (revenueYAxisInst) { revenueYAxisInst.destroy(); revenueYAxisInst = null; }
  if (revenueChartInst) { revenueChartInst.destroy(); revenueChartInst = null; }

  const revCanvas   = document.getElementById('revenueChart')     as HTMLCanvasElement | null;
  const yAxisCanvas = document.getElementById('revenueYAxisChart') as HTMLCanvasElement | null;
  const scrollWrap  = document.querySelector('.analytics-revenue-scroll-wrap') as HTMLElement | null;

  if (revCanvas && yAxisCanvas && scrollWrap) {
    const CHART_H    = 240;              // bars canvas height (px)
    const LABEL_H    = 20;              // HTML x-label row height (px)
    const YAXIS_H    = CHART_H + LABEL_H; // 260 — y-axis canvas covers bars+labels zone
    const MIN_BAR_PX = 40;
    const MIN_W      = 800;             // minimum canvas width for 31 bars to breathe
    const dataLen    = result.timePoints.length;
    const wrapWidth  = scrollWrap.clientWidth || 500;
    const canvasW    = Math.max(wrapWidth, dataLen * MIN_BAR_PX, MIN_W);

    // Shared Y max so both canvases render at identical scale
    const rawMax = result.timePoints.reduce((m: number, t: { revenue: number }) => Math.max(m, t.revenue), 0);
    const yMax   = rawMax > 0 ? Math.ceil(rawMax * 1.15 / 500) * 500 : 1000;

    // ── Y-Axis chart (fixed 62px, transparent bars, only Y scale shown) ──
    // YAXIS_H = 260: the extra LABEL_H at the bottom (via padding) keeps the chart area
    // height identical to the bars canvas chart area (both = CHART_H - 4 top = 236px).
    yAxisCanvas.width  = 62;
    yAxisCanvas.height = YAXIS_H;
    const yCtx = yAxisCanvas.getContext('2d')!;
    revenueYAxisInst = new Chart(yCtx, {
      type: 'bar',
      data: {
        labels: result.timePoints.map((t: { label: string }) => t.label),
        datasets: [{ data: result.timePoints.map((t: { revenue: number }) => t.revenue), backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0 }],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { right: 0, top: 4, bottom: LABEL_H } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: {
            grid: { color: gridClr },
            ticks: { color: tickClr, callback: (v: any) => '₺' + v, font: { size: 9 }, maxTicksLimit: 6 },
            beginAtZero: true,
            max: yMax,
          },
        },
      },
    });

    // ── Main bar chart (scrollable, Y-axis hidden, NO Chart.js x-labels) ──
    // Chart.js x-labels are replaced by HTML elements so they scroll with the canvas and
    // are pixel-perfectly centered under each bar via flex layout.
    // afterFit forces the x-scale to take 0 layout height, so chart area = CHART_H - 4 = 236px
    // — identical to the y-axis canvas, keeping both scales in perfect sync.
    revCanvas.width  = canvasW;
    revCanvas.height = CHART_H;
    const revCtx = revCanvas.getContext('2d')!;
    revenueChartInst = new Chart(revCtx, {
      type: 'bar',
      data: {
        labels: result.timePoints.map((t: { label: string }) => t.label),
        datasets: [{
          label: 'Ciro (₺)',
          data: result.timePoints.map((t: { revenue: number }) => t.revenue),
          backgroundColor: 'rgba(37,99,235,0.72)',
          borderColor: '#2563eb',
          borderWidth: 1,
          borderRadius: 3,
          hoverBackgroundColor: 'rgba(37,99,235,0.9)',
        }],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { left: 0, top: 4, bottom: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => '₺' + (ctx.parsed.y as number).toLocaleString('tr-TR'),
              title: (items: any[]) => items[0].label + ' — ' + result.timePoints[items[0].dataIndex].orders + ' sipariş',
            },
          },
        },
        scales: {
          x: {
            afterFit(scale: any) { scale.height = 0; }, // no layout height — HTML labels used
            ticks:  { display: false },                  // hide Chart.js-rendered tick labels
            grid:   { color: gridClr },                  // keep vertical gridlines
          },
          y: {
            display: false,
            beginAtZero: true,
            max: yMax,
          },
        },
      },
    });

    // ── HTML X-axis labels (live inside scroll-wrap → scroll with canvas) ──
    // Each span gets flex:1, so span width = canvasW / N.
    // Bar center i = (i + 0.5) * (canvasW / N) — identical to span center → perfect alignment.
    const prevLabels = scrollWrap.querySelector('.analytics-revenue-xlabels');
    if (prevLabels) prevLabels.remove();
    const labelsEl = document.createElement('div');
    labelsEl.className = 'analytics-revenue-xlabels';
    labelsEl.style.width = canvasW + 'px';
    result.timePoints.forEach((t: { label: string }) => {
      const s = document.createElement('span');
      s.className = 'analytics-revenue-xlabel';
      s.textContent = t.label;
      labelsEl.appendChild(s);
    });
    scrollWrap.appendChild(labelsEl);
  }

  // ── Top Sellers Doughnut ──
  if (topSellersChartInst) { topSellersChartInst.destroy(); topSellersChartInst = null; }
  const wrapperEl = document.getElementById('topSellersChartWrapper');
  const topCanvas = document.getElementById('topSellersChart') as HTMLCanvasElement | null;
  if (result.topSellers.length === 0) {
    if (wrapperEl) wrapperEl.innerHTML = '<div class="analytics-empty">Bu dönem için veri yok</div>';
  } else {
    if (wrapperEl && !wrapperEl.querySelector('canvas')) {
      wrapperEl.innerHTML = '<canvas id="topSellersChart"></canvas>';
    }
    const freshCanvas = document.getElementById('topSellersChart') as HTMLCanvasElement | null;
    if (freshCanvas) {
      const topCtx = freshCanvas.getContext('2d')!;
      topSellersChartInst = new Chart(topCtx, {
        type: 'doughnut',
        data: {
          labels: result.topSellers.map(s => s.name),
          datasets: [{
            data: result.topSellers.map(s => s.qty),
            backgroundColor: [
              'rgba(37,99,235,0.80)',
              'rgba(22,163,74,0.80)',
              'rgba(245,158,11,0.80)',
              'rgba(239,68,68,0.80)',
              'rgba(139,92,246,0.80)',
            ],
            borderColor:  isDark ? '#1f2840' : '#f8fafc',
            borderWidth: 2,
            hoverOffset: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: tickClr, font: { size: 11 }, boxWidth: 12, padding: 10 },
            },
            tooltip: {
              callbacks: {
                title: (items: any[]) => items[0].label,
                label: (ctx: any) => ' Adet: ' + ctx.parsed,
                afterLabel: (ctx: any) => {
                  const seller = result.topSellers[ctx.dataIndex] as TopSeller;
                  return ' Ciro: ₺' + seller.revenue.toLocaleString('tr-TR');
                },
              },
            },
          },
          cutout: '58%',
        },
      });
    }
  }

  // ── Low Performers List ──
  const lowEl = document.getElementById('lowPerformersList')!;
  if (result.lowPerformers.length === 0) {
    lowEl.innerHTML = '<div class="analytics-empty">Bu dönem için veri yok</div>';
  } else {
    lowEl.innerHTML = result.lowPerformers.map((s, i) =>
      '<div class="performer-row">' +
        '<span class="performer-rank">' + (i + 1) + '</span>' +
        '<span class="performer-icon">' + s.icon + '</span>' +
        '<span class="performer-name">' + s.name + '</span>' +
        '<span class="performer-qty">' + s.qty + ' adet</span>' +
        '<span class="performer-revenue">₺' + s.revenue.toLocaleString('tr-TR') + '</span>' +
      '</div>'
    ).join('');
  }
}

// ── PERSONEL YÖNETİMİ ────────────────────────

async function loadAndRenderStaff(): Promise<void> {
  try {
    staffList = await DB.getUsers();
  } catch (e) {
    console.error('[Staff] getUsers hatası:', e);
  }
  renderStaffList();
}

function renderStaffList(): void {
  const tbody = document.getElementById('staffTableBody')!;
  const q     = staffSearchQuery.trim().toLowerCase();
  const list  = q
    ? staffList.filter(u => u.username.toLowerCase().includes(q))
    : staffList;

  if (list.length === 0) {
    tbody.innerHTML =
      '<tr class="staff-empty-row"><td colspan="5">' +
        '<div class="staff-empty">' +
          '<svg width="36" height="36" viewBox="0 0 48 48" fill="none"><circle cx="18" cy="16" r="6" stroke="currentColor" stroke-width="1.5" opacity="0.4"/><path d="M6 38c0-6.627 5.373-10 12-10s12 3.373 12 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/></svg>' +
          '<p>' + (q ? 'Arama sonucu bulunamadı' : 'Henüz personel yok') + '</p>' +
        '</div>' +
      '</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(u => {
    const roleBadge = u.role === 'admin'
      ? '<span class="role-badge role-badge--admin">★ Yönetici</span>'
      : '<span class="role-badge role-badge--staff">Çalışan</span>';
    return (
      '<tr>' +
        '<td class="col-id" style="color:var(--text3);font-size:12px">' + u.id + '</td>' +
        '<td><strong>' + escapeHtml(u.username) + '</strong></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td><span class="password-text">' + escapeHtml(u.password) + '</span></td>' +
        '<td>' +
          '<div class="staff-row-actions">' +
            '<button class="staff-action-btn staff-action-btn--edit" data-id="' + u.id + '">✏ Düzenle</button>' +
            '<button class="staff-action-btn staff-action-btn--delete" data-id="' + u.id + '">🗑 Sil</button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    );
  }).join('');

  tbody.querySelectorAll('.staff-action-btn--edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = parseInt((btn as HTMLElement).dataset.id!, 10);
      const user = staffList.find(u => u.id === id);
      if (user) openStaffModal('edit', user);
    });
  });

  tbody.querySelectorAll('.staff-action-btn--delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt((btn as HTMLElement).dataset.id!, 10);
      confirmDeleteStaff(id);
    });
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openStaffModal(mode: 'add' | 'edit', user?: StaffUser): void {
  staffEditingId = mode === 'edit' && user ? user.id : null;
  const title    = document.getElementById('staffModalTitle')!;
  const uInput   = document.getElementById('staffModalUsername') as HTMLInputElement;
  const pInput   = document.getElementById('staffModalPassword') as HTMLInputElement;
  const rSelect  = document.getElementById('staffModalRole')     as HTMLSelectElement;
  const errEl    = document.getElementById('staffModalError')!;

  title.textContent   = mode === 'add' ? 'Yeni Personel Ekle' : 'Personeli Düzenle';
  uInput.value        = user ? user.username : '';
  pInput.value        = user ? user.password : '';
  rSelect.value       = user ? user.role     : 'staff';
  errEl.textContent   = '';

  document.getElementById('staffModalOverlay')!.style.display = 'flex';
  setTimeout(() => uInput.focus(), 80);
}

function closeStaffModal(): void {
  document.getElementById('staffModalOverlay')!.style.display = 'none';
  staffEditingId = null;
}

async function saveStaff(): Promise<void> {
  const uInput  = document.getElementById('staffModalUsername') as HTMLInputElement;
  const pInput  = document.getElementById('staffModalPassword') as HTMLInputElement;
  const rSelect = document.getElementById('staffModalRole')     as HTMLSelectElement;
  const errEl   = document.getElementById('staffModalError')!;

  const u = uInput.value.trim();
  const p = pInput.value;
  const r = rSelect.value;

  if (!u || !p) { errEl.textContent = 'Kullanıcı adı ve şifre zorunludur.'; return; }

  const isEdit        = staffEditingId !== null;
  const result: UserResult = isEdit
    ? await DB.updateUser(staffEditingId!, u, p, r)
    : await DB.addUser(u, p, r);

  if (!result.ok) { errEl.textContent = result.error || 'İşlem başarısız.'; return; }

  const roleLabel = r === 'admin' ? 'Yönetici' : 'Çalışan';
  if (isEdit) {
    logActivity('staff_update', activeUser + ' personeli güncelledi: ' + u + ' (' + roleLabel + ')');
  } else {
    logActivity('staff_add', activeUser + ' yeni personel ekledi: ' + u + ' (' + roleLabel + ')');
  }

  closeStaffModal();
  await loadAndRenderStaff();
}

async function confirmDeleteStaff(id: number): Promise<void> {
  const user = staffList.find(u => u.id === id);
  if (!user) return;

  const ok = await showConfirm(
    'Personeli Sil',
    'Bu personeli silmek istediğinize emin misiniz?\n\n' + user.username + ' (' + (user.role === 'admin' ? 'Yönetici' : 'Çalışan') + ')',
    'Evet, Sil',
    'İptal',
    'danger',
  );
  if (!ok) return;

  const result = await DB.deleteUser(id);
  if (!result.ok) {
    await showAlert('Silinemedi', result.error || 'Personel silinemedi.', 'error');
    return;
  }
  logActivity('staff_delete', activeUser + ' personeli sildi: ' + user.username + ' (' + (user.role === 'admin' ? 'Yönetici' : 'Çalışan') + ')');
  await loadAndRenderStaff();
}

function showLogin(): void {
  const userInput = document.getElementById('loginUsername') as HTMLInputElement;
  const passInput = document.getElementById('loginPassword') as HTMLInputElement;
  const errEl     = document.getElementById('loginError')!;

  userInput.value   = '';
  passInput.value   = '';
  errEl.textContent = '';

  userInput.disabled = false;
  userInput.readOnly = false;
  passInput.disabled = false;
  passInput.readOnly = false;

  const typeSelect = document.getElementById('loginTypeSelect');
  const loginForm  = document.getElementById('loginForm');
  const subtitle   = document.getElementById('loginSubtitle');
  if (typeSelect) typeSelect.style.display = '';
  if (loginForm)  loginForm.style.display  = 'none';
  if (subtitle)   subtitle.textContent = 'Giriş türünü seçin';

  const topbar = document.getElementById('posTopbar');
  const layout = document.getElementById('posLayout');
  const tables = document.getElementById('tableScreen');
  if (topbar) topbar.style.display = 'none';
  if (layout) layout.style.display = 'none';
  if (tables) tables.style.display = 'none';
  const overlay = document.getElementById('loginOverlay')!;
  overlay.style.display = 'flex';
  overlay.classList.add('active');

  function attemptFocus(): void {
    if (window.electronAPI && window.electronAPI.focusWindow) {
      window.electronAPI.focusWindow();
    }
    window.focus();
    const el = document.getElementById('loginUsername') as HTMLInputElement | null;
    if (el) {
      el.disabled = false;
      el.readOnly = false;
      el.focus();
    }
  }
  setTimeout(attemptFocus, 150);
  setTimeout(attemptFocus, 400);
  setTimeout(attemptFocus, 800);
}

function handleLogin(): void {
  const user  = (document.getElementById('loginUsername') as HTMLInputElement).value.trim();
  const pass  = (document.getElementById('loginPassword') as HTMLInputElement).value;
  const errEl = document.getElementById('loginError')!;

  const matched = staffList.find(u => u.username === user && u.password === pass);

  if (matched) {
    const isAdmin = matched.role === 'admin';
    if (_loginMode === 'admin' && !isAdmin) {
      errEl.textContent = 'Bu alan sadece yönetici girişi içindir.';
      (document.getElementById('loginPassword') as HTMLInputElement).value = '';
      (document.getElementById('loginPassword') as HTMLInputElement).focus();
      const card = document.querySelector('.login-card') as HTMLElement | null;
      if (card) { card.style.animation = 'none'; void card.offsetHeight; card.style.animation = 'loginShake 0.35s ease'; }
      return;
    }
    if (_loginMode === 'staff' && isAdmin) {
      errEl.textContent = 'Lütfen yönetici panelinden giriş yapınız.';
      (document.getElementById('loginPassword') as HTMLInputElement).value = '';
      (document.getElementById('loginPassword') as HTMLInputElement).focus();
      const card = document.querySelector('.login-card') as HTMLElement | null;
      if (card) { card.style.animation = 'none'; void card.offsetHeight; card.style.animation = 'loginShake 0.35s ease'; }
      return;
    }
    _sessionActive = true;
    activeUser     = matched.username;
    userRole       = isAdmin ? 'admin' : 'staff';
    errEl.textContent = '';
    window.electronAPI?.setCurrentUser(activeUser);
    logActivity('auth_login', activeUser + ' sisteme giriş yaptı (' + (isAdmin ? 'Yönetici' : 'Çalışan') + ')');
    showPOS();
  } else {
    errEl.textContent = 'Kullanıcı adı veya şifre hatalı.';
    const passInput = document.getElementById('loginPassword') as HTMLInputElement;
    const userInput = document.getElementById('loginUsername') as HTMLInputElement;
    passInput.value    = '';
    passInput.disabled = false;
    userInput.disabled = false;
    passInput.focus();
    const card = document.querySelector('.login-card') as HTMLElement | null;
    if (card) { card.style.animation = 'none'; void card.offsetHeight; card.style.animation = 'loginShake 0.35s ease'; }
  }
}

function handleLogout(): void {
  document.getElementById('logoutConfirmOverlay')!.style.display = 'flex';
}

function doLogout(): void {
  document.getElementById('logoutConfirmOverlay')!.style.display = 'none';
  logActivity('auth_logout', activeUser + ' sistemden çıkış yaptı');
  _sessionActive = false;
  activeUser     = '';
  userRole       = '';
  window.electronAPI?.setCurrentUser('');
  location.reload();
}

// ── Sil (Yalnızca Admin) ──────────────────────

async function handleHistoryDelete(): Promise<void> {
  if (userRole !== 'admin') return;
  if (salesHistory.length === 0) return;

  const count = salesHistory.length;
  const ok    = await showConfirm(
    'Kayıtları Sil',
    'Silmek istediğinize emin misiniz?',
    'Tamam',
    'İptal',
    'danger',
  );
  if (!ok) return;

  const idsToHide = salesHistory.map(s => s.id);
  for (const saleId of idsToHide) {
    await DB.hideOrder(saleId);
  }

  salesHistory   = [];
  expandedSaleId = null;
  renderHistory();

  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
    'background:#16a34a;color:#fff;padding:10px 22px;border-radius:8px;z-index:9999;' +
    'font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);transition:opacity .4s';
  toast.textContent = count + ' kayıt görünümden kaldırıldı';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
}

// ══════════════════════════════════════
//  BAŞLATMA
// ══════════════════════════════════════

// ── Başlık Çubuğu İkonları ────────────────────
const ICON_MINIMIZE  = '<svg width="10" height="1"  viewBox="0 0 10 1"  fill="none"><line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" stroke-width="1.2"/></svg>';
const ICON_MAXIMIZE  = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>';
const ICON_RESTORE   = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2.2" y="0.6" width="7.2" height="7.2" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="0.6" y="2.2" width="7.2" height="7.2" rx="1" stroke="currentColor" stroke-width="1.2" fill="var(--bg2)"/></svg>';
const ICON_CLOSE     = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><line x1="0.7" y1="0.7" x2="9.3" y2="9.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="9.3" y1="0.7" x2="0.7" y2="9.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

// ── MOCK DATA (STRESS TEST) ──────────────────────────────────────────────────
// Generates ~3 years of fake orders and injects into in-memory state only.
// Data disappears on refresh. Console: generateMockData() / clearMockData()

let mockDataActive = false;

interface MockProduct { name: string; icon: string; price: number; w: number; isDessert?: boolean }
interface MockExtra   { name: string; price: number }

function generateMockData(): void {
  if (mockDataActive) { clearMockData(); return; }

  const COFFEES: MockProduct[] = [
    { name: 'Latte',                   icon: '🥛', price: 110, w: 15 },
    { name: 'Flat White',              icon: '☕', price: 115, w: 12 },
    { name: 'Cappuccino',              icon: '☕', price: 110, w: 11 },
    { name: 'Americano',               icon: '🫖', price: 85,  w: 10 },
    { name: 'Karamel Macchiato',       icon: '🍮', price: 130, w:  8 },
    { name: 'Espresso',                icon: '☕', price: 70,  w:  7 },
    { name: 'Filtre Kahve',            icon: '☕', price: 80,  w:  6 },
    { name: 'Macchiato',               icon: '☕', price: 95,  w:  5 },
    { name: 'Mocha',                   icon: '🍫', price: 120, w:  5 },
    { name: 'Çift Espresso',           icon: '☕', price: 90,  w:  4 },
    { name: 'Beyaz Çikolatalı Mocha',  icon: '🤍', price: 130, w:  4 },
    { name: 'Soğuk Latte',             icon: '🥛', price: 120, w:  5 },
    { name: 'Cold Brew',               icon: '🧊', price: 120, w:  4 },
    { name: 'Soğuk Americano',         icon: '🥤', price: 95,  w:  3 },
    { name: 'Soğuk Mocha',             icon: '🍫', price: 130, w:  2 },
    { name: 'Soğuk Karamel Latte',     icon: '🍮', price: 135, w:  2 },
    { name: 'Affogato',                icon: '🍨', price: 140, w:  2 },
  ];
  const DESSERTS: MockProduct[] = [
    { name: 'Kruvasan',               icon: '🥐', price: 90,  w: 5, isDessert: true },
    { name: 'Cheesecake',             icon: '🍰', price: 150, w: 4, isDessert: true },
    { name: 'Brownie',                icon: '🍫', price: 120, w: 4, isDessert: true },
    { name: 'Muffin',                 icon: '🧁', price: 90,  w: 4, isDessert: true },
    { name: 'Kurabiye',               icon: '🍪', price: 70,  w: 4, isDessert: true },
    { name: 'Çikolatalı Kek',         icon: '🎂', price: 140, w: 3, isDessert: true },
    { name: 'Tiramisu',               icon: '🍮', price: 155, w: 3, isDessert: true },
    { name: 'Yaban Mersinli Muffin',  icon: '🧁', price: 95,  w: 3, isDessert: true },
    { name: 'Çikolatalı Kruvasan',    icon: '🥐', price: 110, w: 3, isDessert: true },
    { name: 'San Sebastian',          icon: '🍰', price: 165, w: 2, isDessert: true },
    { name: 'Elmalı Turta',           icon: '🥧', price: 130, w: 2, isDessert: true },
    { name: 'Red Velvet',             icon: '🎂', price: 150, w: 2, isDessert: true },
    { name: 'Brownie Dondurmalı',     icon: '🍨', price: 160, w: 2, isDessert: true },
  ];
  const C_EXTRAS: MockExtra[] = [
    { name: 'Ekstra Shot',     price: 20 },
    { name: 'Yulaf Sütü',     price: 25 },
    { name: 'Badem Sütü',     price: 25 },
    { name: 'Vanilya Şurubu', price: 15 },
    { name: 'Karamel Şurubu', price: 15 },
    { name: 'Fındık Şurubu',  price: 15 },
  ];
  const D_EXTRAS: MockExtra[] = [
    { name: 'Dondurma',       price: 40 },
    { name: 'Çikolata Sosu',  price: 20 },
    { name: 'Karamel Sosu',   price: 20 },
    { name: 'Krem Şanti',     price: 20 },
    { name: 'Fındık Kırığı',  price: 25 },
    { name: 'Antep Fıstığı',  price: 30 },
  ];

  function pick(pool: MockProduct[]): MockProduct {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    for (const p of pool) { r -= p.w; if (r <= 0) return p; }
    return pool[pool.length - 1];
  }
  function pickExtra(pool: MockExtra[]): MockExtra {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function rnd(lo: number, hi: number): number {
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }
  function pad2(n: number): string { return String(n).padStart(2, '0'); }

  const records: SaleRecord[] = [];
  let idSeq = 0;

  const cursor = new Date(2023, 0, 1);
  const endDay = new Date(2026, 3, 8); // Apr 8, 2026

  while (cursor <= endDay) {
    const dow = cursor.getDay();
    const isWeekend = dow === 0 || dow === 6;
    // Higher volume on weekends, slight midweek dip
    const baseOrders = isWeekend ? rnd(18, 28) : (dow === 3 ? rnd(10, 15) : rnd(12, 18));

    for (let o = 0; o < baseOrders; o++) {
      // Realistic hourly distribution: peak 09-11 and 14-17
      const hourPool = [8,9,9,9,10,10,10,11,11,12,13,14,14,14,15,15,15,16,16,17,17,18,19,20];
      const hour   = hourPool[rnd(0, hourPool.length - 1)];
      const minute = rnd(0, 59);
      const second = rnd(0, 59);
      const dateStr = cursor.getFullYear() + '-' +
        pad2(cursor.getMonth() + 1) + '-' +
        pad2(cursor.getDate()) + ' ' +
        pad2(hour) + ':' + pad2(minute) + ':' + pad2(second);

      // 1-3 items per order
      const r3 = Math.random();
      const numItems = r3 < 0.68 ? 1 : r3 < 0.92 ? 2 : 3;
      const items: SaleItem[] = [];

      for (let i = 0; i < numItems; i++) {
        const isCoffee = Math.random() < 0.70;
        const prod     = isCoffee ? pick(COFFEES) : pick(DESSERTS);
        const extraPool = isCoffee ? C_EXTRAS : D_EXTRAS;
        const extraChance = isCoffee ? 0.30 : 0.20;

        let extras: string[] = [];
        let extrasPrice = 0;
        if (Math.random() < extraChance) {
          const n = Math.random() < 0.75 ? 1 : 2;
          const chosen = new Set<string>();
          while (chosen.size < n) { chosen.add(pickExtra(extraPool).name); }
          extras = [...chosen];
          for (const exName of extras) {
            const ex = extraPool.find(e => e.name === exName);
            if (ex) extrasPrice += ex.price;
          }
        }

        const unitPrice = prod.price + extrasPrice;
        const lineTotal = unitPrice; // qty always 1
        items.push({ name: prod.name, icon: prod.icon, qty: 1, unitPrice, lineTotal, extras });
      }

      const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
      const tax      = Math.round(subtotal * TAX_RATE);
      const total    = subtotal + tax;

      const payR = Math.random();
      let paymentType: string, cashAmount: number, cardAmount: number;
      if (payR < 0.40) {
        paymentType = 'cash'; cashAmount = total; cardAmount = 0;
      } else {
        paymentType = 'card'; cashAmount = 0; cardAmount = total;
      }

      records.push({
        id: 'MOCK-' + String(++idSeq).padStart(6, '0'),
        datetime: dateStr,
        tableId: '', tableName: '',
        subtotal, tax, discountAmount: 0,
        total, paymentType, cashAmount, cardAmount, items,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  // Sort chronologically and prepend to live history
  records.sort((a, b) => a.datetime.localeCompare(b.datetime));
  analyticsHistory    = [...records, ...analyticsHistory];
  productSalesHistory = [...records, ...productSalesHistory];
  mockDataActive = true;
  _updateMockBadge();
  renderAnalyticsCharts();
  renderProductSalesTable();
  console.info('[MockData] Enjekte edildi:', records.length, 'sipariş (Oca 2023 – Nis 2026)');
}

async function clearMockData(): Promise<void> {
  try {
    const fresh = await DB.getAllOrders();
    analyticsHistory    = fresh;
    productSalesHistory = [...fresh];
    mockDataActive = false;
    _updateMockBadge();
    renderAnalyticsCharts();
    renderProductSalesTable();
    console.info('[MockData] Temizlendi — gerçek veriler geri yüklendi.');
  } catch (e) {
    console.error('[MockData] Temizleme hatası:', e);
  }
}

function _updateMockBadge(): void {
  ['analyticsMockBtn', 'productSalesMockBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (mockDataActive) {
      btn.textContent = '✕ Mock';
      btn.classList.add('mock-data-btn--active');
      btn.title = 'Mock veriyi temizle (clearMockData())';
    } else {
      btn.textContent = '🧪';
      btn.classList.remove('mock-data-btn--active');
      btn.title = 'Stres testi için mock veri oluştur / temizle';
    }
  });
}

// Expose as console commands
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).generateMockData = generateMockData;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).clearMockData    = clearMockData;

document.addEventListener('DOMContentLoaded', async function() {
  loadPersistedTables();
  loadReservations();

  if (!isLoggedIn()) {
    showLogin();
  } else {
    showPOS();
  }

  document.getElementById('loginBtn')!.addEventListener('click', handleLogin);
  (document.getElementById('loginPassword') as HTMLInputElement).addEventListener('keydown', function(e: KeyboardEvent) {
    if (e.key === 'Enter') handleLogin();
  });
  (document.getElementById('loginUsername') as HTMLInputElement).addEventListener('keydown', function(e: KeyboardEvent) {
    if (e.key === 'Enter') (document.getElementById('loginPassword') as HTMLInputElement).focus();
  });

  function activateLoginPanel(mode: 'admin' | 'staff'): void {
    _loginMode = mode;
    const isAdmin = mode === 'admin';
    document.getElementById('loginTypeSelect')!.style.display = 'none';
    document.getElementById('loginForm')!.style.display       = '';
    const subtitle = document.getElementById('loginSubtitle');
    const badge    = document.getElementById('loginRoleBadge');
    if (subtitle) subtitle.textContent = isAdmin ? 'Yönetici Girişi' : 'Çalışan Girişi';
    if (badge) {
      badge.textContent = isAdmin ? 'Yönetici' : 'Çalışan';
      badge.className   = 'login-role-badge ' + (isAdmin ? 'badge-admin' : 'badge-staff');
    }
    (document.getElementById('loginUsername') as HTMLInputElement).value = '';
    (document.getElementById('loginPassword') as HTMLInputElement).value = '';
    document.getElementById('loginError')!.textContent = '';
    setTimeout(() => {
      const u = document.getElementById('loginUsername') as HTMLInputElement | null;
      if (u) { u.disabled = false; u.focus(); }
    }, 80);
  }

  document.getElementById('btnAdminLogin')!.addEventListener('click', () => activateLoginPanel('admin'));
  document.getElementById('btnStaffLogin')!.addEventListener('click', () => activateLoginPanel('staff'));
  document.getElementById('loginBackBtn')!.addEventListener('click', () => {
    document.getElementById('loginForm')!.style.display       = 'none';
    document.getElementById('loginTypeSelect')!.style.display = '';
    document.getElementById('loginSubtitle')!.textContent     = 'Giriş türünü seçin';
    document.getElementById('loginError')!.textContent        = '';
  });

  loadTheme();
  initCategoryNav();
  initExtrasToggle();
  startClock();
  renderProducts();
  renderOrder();
  renderExtras();

  try {
    analyticsHistory = await DB.getAllOrders();
    salesHistory     = await DB.getVisibleOrders();
    staffList        = await DB.getUsers();
    inventoryCache   = await DB.getInventory() as InventoryItem[];
    console.log('[POS] DB bağlantısı başarılı. Görünür:', salesHistory.length, '| Toplam:', analyticsHistory.length, '| Personel:', staffList.length, '| Envanter:', inventoryCache.length);
    renderProducts(); // Re-render with inventory data
  } catch (err) {
    console.error('[POS] DB bağlantısı başarısız:', err);
    salesHistory     = [];
    analyticsHistory = [];
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;padding:10px;text-align:center;z-index:9999;font-size:13px;';
    banner.textContent = '⚠️ Veritabanı bağlantısı kurulamadı. npm install çalıştırıldı mı?';
    document.body.appendChild(banner);
  }
  renderHistory();
  renderTableScreen();

  // ── Özel Başlık Çubuğu Kontrolleri ──────────────

  const eAPI = window.electronAPI;
  if (eAPI) {
    document.getElementById('titleBarMinBtn')?.addEventListener('click', () => eAPI.minimizeWindow());
    document.getElementById('titleBarMaxBtn')?.addEventListener('click', () => eAPI.maximizeWindow());
    document.getElementById('titleBarCloseBtn')?.addEventListener('click', async () => {
      const ok = await showConfirm(
        'Çıkış',
        'Çıkış yapmak istediğinize emin misiniz?',
        'Tamam',
        'İptal',
        'danger',
      );
      if (ok) eAPI.closeWindow();
    });
    eAPI.onMaximizeChange((isMaximized: boolean) => {
      const icon = document.getElementById('titleBarMaxIcon');
      if (icon) icon.innerHTML = isMaximized ? ICON_RESTORE : ICON_MAXIMIZE;
    });
  }

  // ── Event Listener'lar ────────────────────────

  document.getElementById('themeToggleBtn')!.addEventListener('click', toggleTheme);

  document.getElementById('clearBtn')!.addEventListener('click', async function() {
    if (order.length === 0) return;

    // Classify order entries
    const isInv = (e: OrderEntry) => !!inventoryCache.find(iv => iv.product_name === e.product.name);

    // Sent inventory items that genuinely came from tracked stock (eligible for return)
    const sentInvItems: StockReversalItem[] = order
      .filter(e => isInv(e) && (e.sentQty || 0) > 0)
      .filter(e => (e.stockedQty ?? (e.sentQty as number)) > 0)
      .map(e => {
        const stocked = e.stockedQty ?? (e.sentQty as number);
        return { name: e.product.name, icon: e.product.icon, maxQty: stocked, originalQty: e.sentQty as number };
      });

    // ── Step 1: "Sepeti Temizle" confirmation ─────────────────
    const confirmed = await showConfirm(
      'Sepeti Temizle',
      'Sepeti temizlemek istediğinize emin misiniz?',
      'Evet, Sil', 'İptal', 'danger'
    );

    if (confirmed) {
      // "Evet, Sil": delete non-inventory items and pending-only inventory items immediately;
      // keep only sent inventory items (they are handled in Step 2).
      order = order.filter(e => isInv(e) && (e.sentQty || 0) > 0);

      if (sentInvItems.length === 0) {
        // No sent inventory items with stock to return — fully clear the cart.
        order = [];
        activeExtras = []; activeDessertExtras = [];
        saveTableOrder(); renderOrder(); renderProducts(); renderExtras(); updateTotals();
        return;
      }
      // Intermediate render: only sent inventory items remain visible in the cart.
      saveTableOrder(); renderOrder(); renderProducts(); updateTotals();
    } else {
      // "İptal": no items deleted yet — still proceed to Step 2 for stock decisions.
      if (sentInvItems.length === 0) return; // Nothing stock-related to handle.
    }

    // ── Step 2: "Stok İadesi" modal ────────────────────────────
    const result = await showStockReversalModal(sentInvItems);
    if (result === null) return; // "Vazgeç" — keep remaining items in cart as-is.

    // "Onayla ve Sil": restore selected stock quantities, then remove sent inventory items.
    if (result.length > 0) {
      try {
        await DB.restoreStock(result);
        inventoryCache = await DB.getInventory() as InventoryItem[];
      } catch (err) {
        console.error('[POS] Stok geri yükleme hatası:', err);
      }
    }

    const clearTableDesc = activeTableName ? ' ' + activeTableName : '';
    logActivity('order_clear', activeUser + clearTableDesc + ' siparişini temizledi');

    // Remove all remaining sent inventory items (incl. over-stock-only ones not shown in modal).
    order = order.filter(e => !(isInv(e) && (e.sentQty || 0) > 0));
    if (order.length === 0) { activeExtras = []; activeDessertExtras = []; }
    saveTableOrder(); renderOrder(); renderProducts(); renderExtras(); updateTotals();
  });

  document.getElementById('completeBtn')!.addEventListener('click', completeOrder);
  document.getElementById('kitchenBtn')!.addEventListener('click', showKitchenReceipt);
  document.getElementById('receiptPreviewBtn')!.addEventListener('click', showReceiptPreview);
  document.getElementById('kitchenCloseBtn')!.addEventListener('click', function() {
    document.getElementById('kitchenOverlay')!.classList.remove('visible');
  });
  document.getElementById('receiptOkBtn')!.addEventListener('click', closeReceipt);

  document.getElementById('historyToggleBtnTable')!.addEventListener('click', function() {
    document.getElementById('historyPanel')!.classList.contains('visible')
      ? closeHistory()
      : openHistory();
  });
  document.getElementById('themeToggleBtnTable')!.addEventListener('click', toggleTheme);
  document.getElementById('logoutBtn')!.addEventListener('click', handleLogout);
  document.getElementById('logoutBtnTable')!.addEventListener('click', handleLogout);
  document.getElementById('logoutConfirmYes')!.addEventListener('click', doLogout);
  document.getElementById('logoutConfirmNo')!.addEventListener('click', function() {
    document.getElementById('logoutConfirmOverlay')!.style.display = 'none';
  });

  // ── Ödeme Modalı ──────────────────────────────

  document.getElementById('payDiscountBtn')!.addEventListener('click', () => {
    const pctEl   = document.getElementById('discountPctValue')   as HTMLInputElement;
    const fixedEl = document.getElementById('discountFixedValue') as HTMLInputElement;
    if (discountValue > 0 && discountType === 'pct') {
      pctEl.value   = String(discountValue);
      fixedEl.value = '';
    } else if (discountValue > 0 && discountType === 'fixed') {
      fixedEl.value = String(discountValue);
      pctEl.value   = '';
    } else {
      pctEl.value   = '';
      fixedEl.value = '';
    }
    document.getElementById('discountError')!.textContent = '';
    document.getElementById('discountOverlay')!.style.display = 'flex';
    setTimeout(() => pctEl.focus(), 80);
  });

  (document.getElementById('discountPctValue') as HTMLInputElement).addEventListener('input', () => {
    const pctEl = document.getElementById('discountPctValue') as HTMLInputElement;
    if (pctEl.value !== '') {
      (document.getElementById('discountFixedValue') as HTMLInputElement).value = '';
    }
  });

  (document.getElementById('discountFixedValue') as HTMLInputElement).addEventListener('input', () => {
    const fixedEl = document.getElementById('discountFixedValue') as HTMLInputElement;
    if (fixedEl.value !== '') {
      (document.getElementById('discountPctValue') as HTMLInputElement).value = '';
    }
  });

  document.getElementById('discountApplyBtn')!.addEventListener('click', async () => {
    const pctVal   = parseFloat((document.getElementById('discountPctValue')   as HTMLInputElement).value);
    const fixedVal = parseFloat((document.getElementById('discountFixedValue') as HTMLInputElement).value);
    const errEl    = document.getElementById('discountError')!;

    const pctActive   = !isNaN(pctVal)   && pctVal   > 0;
    const fixedActive = !isNaN(fixedVal) && fixedVal > 0;

    if (pctActive && fixedActive) {
      await showAlert('İndirim Hatası', 'Aynı anda hem yüzde hem de tutar indirimi uygulanamaz.\nLütfen sadece birini seçin.', 'warning');
      return;
    }

    if (pctActive) {
      if (pctVal > 100) { errEl.textContent = "Yüzde 100'den fazla olamaz."; return; }
      discountType  = 'pct';
      discountValue = pctVal;
    } else if (fixedActive) {
      if (fixedVal < 0) { errEl.textContent = 'Geçerli bir tutar girin.'; return; }
      discountType  = 'fixed';
      discountValue = fixedVal;
    } else {
      discountType  = 'pct';
      discountValue = 0;
    }

    document.getElementById('discountOverlay')!.style.display = 'none';
    if (typeof updatePayStep1Totals === 'function') updatePayStep1Totals();

    const discBtn = document.getElementById('payDiscountBtn');
    if (discBtn) {
      discBtn.textContent = discountValue > 0
        ? 'İndirim: ' + (discountType === 'pct' ? '%' + discountValue : '₺' + discountValue) + ' ✓'
        : 'İndirim Uygula';
    }

  });

  ['discountPctValue', 'discountFixedValue'].forEach(id => {
    document.getElementById(id)!.addEventListener('keydown', (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') (document.getElementById('discountApplyBtn') as HTMLButtonElement).click();
    });
  });

  document.getElementById('discountCancelBtn')!.addEventListener('click', () => {
    document.getElementById('discountOverlay')!.style.display = 'none';
  });

  document.getElementById('paySelectAllBtn')!.addEventListener('click', () => {
    const allSelected = paySelections.every(s => s.payQty === s.maxQty);
    if (allSelected) {
      paySelections.forEach(sel => { sel.payQty = 0; });
      discountValue = 0;
      discountType  = 'pct';
      const discBtn = document.getElementById('payDiscountBtn');
      if (discBtn) discBtn.textContent = 'İndirim Uygula';
    } else {
      paySelections.forEach(sel => { sel.payQty = sel.maxQty; });
    }
    renderPayStep1();
  });

  document.getElementById('payStep1NextBtn')!.addEventListener('click', () => {
    const rawText = document.getElementById('paymentTotalDisplay')!.textContent!.replace('₺','').trim();
    const total   = Math.round(parseFloat(rawText) || 0);
    document.getElementById('payStep2Total')!.textContent = '\u20ba' + total;
    document.getElementById('splitError')!.textContent = '';
    (document.getElementById('splitCash') as HTMLInputElement).value = '';
    (document.getElementById('splitCard') as HTMLInputElement).value = '';
    document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
    (document.querySelector('[data-method="cash"]') as HTMLButtonElement).classList.add('active');
    document.getElementById('splitInputs')!.style.display = 'none';
    document.getElementById('payStep1')!.style.display = 'none';
    document.getElementById('payStep2')!.style.display = '';
  });

  document.getElementById('payStep2BackBtn')!.addEventListener('click', () => {
    document.getElementById('payStep2')!.style.display = 'none';
    document.getElementById('payStep1')!.style.display = '';
  });

  document.querySelectorAll('.payment-method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const method = (btn as HTMLButtonElement).dataset.method;
      document.getElementById('splitInputs')!.style.display = method === 'split' ? 'flex' : 'none';
      document.getElementById('splitError')!.textContent = '';
    });
  });

  document.getElementById('paymentConfirmBtn')!.addEventListener('click', () => {
    const method    = (document.querySelector('.payment-method-btn.active') as HTMLButtonElement).dataset.method ?? 'cash';
    const totalText = document.getElementById('payStep2Total')!.textContent!.replace('₺','').replace(/\./g,'').replace(',','.').trim();
    const total     = Math.round(parseFloat(totalText) || 0);
    const errEl     = document.getElementById('splitError')!;

    if (method === 'cash') {
      finalizeOrder('cash', total, 0);
    } else if (method === 'card') {
      finalizeOrder('card', 0, total);
    } else {
      const cash = parseInt((document.getElementById('splitCash') as HTMLInputElement).value, 10) || 0;
      const card = parseInt((document.getElementById('splitCard') as HTMLInputElement).value, 10) || 0;
      if (cash < 0 || card < 0) { errEl.textContent = 'Tutar negatif olamaz.'; return; }
      if (cash + card !== total) {
        errEl.textContent = 'Nakit + Kart toplamı ₺' + total + ' olmalı. (Şu an: ₺' + (cash + card) + ')'; return;
      }
      finalizeOrder('split', cash, card);
    }
  });

  document.getElementById('paymentCancelBtn')!.addEventListener('click', () => {
    discountValue = 0;
    discountType  = 'pct';
    const discBtn = document.getElementById('payDiscountBtn');
    if (discBtn) discBtn.textContent = 'İndirim Uygula';
    document.getElementById('paymentOverlay')!.classList.remove('visible');
  });
  document.getElementById('newOrderBtn')!.addEventListener('click', closeReceipt);

  document.getElementById('modalOverlay')!.addEventListener('click', function(e: MouseEvent) {
    if (e.target === e.currentTarget) closeReceipt();
  });

  document.getElementById('historyToggleBtn')!.addEventListener('click', function() {
    document.getElementById('historyPanel')!.classList.contains('visible')
      ? closeHistory()
      : openHistory();
  });
  document.getElementById('historyCloseBtn')!.addEventListener('click', closeHistory);
  document.getElementById('historyBackdrop')!.addEventListener('click', closeHistory);

  document.getElementById('historySearch')!.addEventListener('input', function(e: Event) {
    historyQuery = (e.target as HTMLInputElement).value;
    renderHistory();
  });

  document.getElementById('exportCsvBtn')!.addEventListener('click', exportToCSV);
  document.getElementById('exportExcelBtn')!.addEventListener('click', exportToExcel);

  // ── Admin Seçim Ekranı ────────────────────────

  document.getElementById('selectionPOSBtn')!.addEventListener('click', () => {
    showTableScreenDirect();
  });

  document.getElementById('selectionAnalyticsBtn')!.addEventListener('click', () => {
    showAnalyticsDashboard();
  });

  document.getElementById('logoutBtnSelection')!.addEventListener('click', handleLogout);
  document.getElementById('themeToggleBtnSelection')!.addEventListener('click', toggleTheme);

  // Back to selection from table screen (admin only)
  document.getElementById('tableScreenBackBtn')!.addEventListener('click', () => {
    if (order.length > 0) saveTableOrder();
    activeTableId   = null;
    activeTableName = '';
    order           = [];
    showSelectionScreen();
  });

  // Back to tables from POS topbar left button
  document.getElementById('backToTablesBtnLeft')!.addEventListener('click', () => {
    goBackToTables();
  });

  // ── Analitik Dashboard ────────────────────────

  document.getElementById('analyticsBackBtn')!.addEventListener('click', () => {
    if (revenueYAxisInst)    { revenueYAxisInst.destroy();    revenueYAxisInst    = null; }
    if (revenueChartInst)    { revenueChartInst.destroy();    revenueChartInst    = null; }
    if (topSellersChartInst) { topSellersChartInst.destroy(); topSellersChartInst = null; }
    const xl = document.querySelector('.analytics-revenue-xlabels');
    if (xl) xl.remove();
    showSelectionScreen();
  });

  document.getElementById('themeToggleBtnAnalytics')!.addEventListener('click', () => {
    toggleTheme();
    renderAnalyticsCharts();
  });

  document.querySelectorAll('#periodBtnGroup .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#periodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      analyticsPeriod = (btn as HTMLButtonElement).dataset.period as AnalyticsPeriod;
      analyticsMonth  = null;
      analyticsDay    = null;
      analyticsRelativeN = null; analyticsRelativeUnit = null;
      (document.getElementById('analyticsMonthFilter') as HTMLInputElement).value = '';
      (document.getElementById('analyticsDayFilter')   as HTMLInputElement).value = '';
      (document.getElementById('analyticsRelativeNInput') as HTMLInputElement).value = '';
      updateAnalyticsFilterState();
      renderAnalyticsCharts();
    });
  });

  document.getElementById('analyticsMonthFilter')!.addEventListener('change', (e: Event) => {
    analyticsMonth = (e.target as HTMLInputElement).value || null;
    if (analyticsMonth) {
      analyticsDay    = null;
      analyticsPeriod = 'monthly';
      analyticsRelativeN = null; analyticsRelativeUnit = null;
      document.querySelectorAll('#periodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
      const monthlyBtn = document.querySelector('#periodBtnGroup [data-period="monthly"]');
      if (monthlyBtn) monthlyBtn.classList.add('active');
      (document.getElementById('analyticsDayFilter') as HTMLInputElement).value = '';
      (document.getElementById('analyticsRelativeNInput') as HTMLInputElement).value = '';
    }
    updateAnalyticsFilterState();
    renderAnalyticsCharts();
  });

  document.getElementById('analyticsDayFilter')!.addEventListener('change', (e: Event) => {
    analyticsDay = (e.target as HTMLInputElement).value || null;
    if (analyticsDay) {
      analyticsMonth  = null;
      analyticsPeriod = 'daily';
      analyticsRelativeN = null; analyticsRelativeUnit = null;
      document.querySelectorAll('#periodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
      const dailyBtn = document.querySelector('#periodBtnGroup [data-period="daily"]');
      if (dailyBtn) dailyBtn.classList.add('active');
      (document.getElementById('analyticsMonthFilter') as HTMLInputElement).value = '';
      (document.getElementById('analyticsRelativeNInput') as HTMLInputElement).value = '';
    }
    updateAnalyticsFilterState();
    renderAnalyticsCharts();
  });

  document.getElementById('analyticsTodayBtn')!.addEventListener('click', () => {
    const t = new Date();
    const yyyy = t.getFullYear();
    const mm   = String(t.getMonth() + 1).padStart(2, '0');
    const dd   = String(t.getDate()).padStart(2, '0');
    analyticsDay    = yyyy + '-' + mm + '-' + dd;
    analyticsMonth  = null;
    analyticsPeriod = 'daily';
    analyticsRelativeN = null; analyticsRelativeUnit = null;
    (document.getElementById('analyticsMonthFilter') as HTMLInputElement).value = '';
    (document.getElementById('analyticsDayFilter')   as HTMLInputElement).value = analyticsDay;
    (document.getElementById('analyticsRelativeNInput') as HTMLInputElement).value = '';
    document.querySelectorAll('#periodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
    const dailyBtn = document.querySelector('#periodBtnGroup [data-period="daily"]');
    if (dailyBtn) dailyBtn.classList.add('active');
    updateAnalyticsFilterState();
    renderAnalyticsCharts();
  });

  document.getElementById('exportPdfBtn')!.addEventListener('click', () => {
    exportAnalyticsPDF();
  });

  // ── Analytics: Relative Filter ───────────────
  function applyAnalyticsRelative(): void {
    const n = parseInt((document.getElementById('analyticsRelativeNInput') as HTMLInputElement).value, 10);
    if (!n || n < 1) return;
    const unit = (document.getElementById('analyticsRelativeUnitSelect') as HTMLSelectElement).value;
    analyticsRelativeN    = n;
    analyticsRelativeUnit = unit;
    analyticsDay   = null; analyticsMonth = null;
    (document.getElementById('analyticsDayFilter')   as HTMLInputElement).value = '';
    (document.getElementById('analyticsMonthFilter') as HTMLInputElement).value = '';
    document.querySelectorAll('#periodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
    updateAnalyticsFilterState();
    renderAnalyticsCharts();
  }
  document.getElementById('analyticsRelativeApply')!.addEventListener('click', applyAnalyticsRelative);
  document.getElementById('analyticsRelativeNInput')!.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') applyAnalyticsRelative();
  });

  // ── Personel Yönetimi ─────────────────────────

  document.getElementById('selectionStaffBtn')!.addEventListener('click', () => {
    showStaffManagement();
  });

  document.getElementById('staffBackBtn')!.addEventListener('click', () => {
    showSelectionScreen();
  });

  document.getElementById('themeToggleBtnStaff')!.addEventListener('click', toggleTheme);

  document.getElementById('addStaffBtn')!.addEventListener('click', () => {
    openStaffModal('add');
  });

  document.getElementById('staffSearch')!.addEventListener('input', (e: Event) => {
    staffSearchQuery = (e.target as HTMLInputElement).value;
    renderStaffList();
  });

  document.getElementById('staffModalSaveBtn')!.addEventListener('click', saveStaff);
  document.getElementById('staffModalCancelBtn')!.addEventListener('click', closeStaffModal);
  document.getElementById('staffModalCloseBtn')!.addEventListener('click',  closeStaffModal);

  // Close modal on Enter in any input
  ['staffModalUsername','staffModalPassword'].forEach(id => {
    document.getElementById(id)!.addEventListener('keydown', (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') saveStaff();
    });
  });

  // ── İşlem Kayıtları ────────────────────────────

  document.getElementById('selectionLogsBtn')!.addEventListener('click', () => {
    showLogsScreen();
  });

  document.getElementById('logsBackBtn')!.addEventListener('click', () => {
    showSelectionScreen();
  });

  document.getElementById('themeToggleBtnLogs')!.addEventListener('click', toggleTheme);

  document.getElementById('logsSearch')!.addEventListener('input', (e: Event) => {
    logsSearchQuery = (e.target as HTMLInputElement).value;
    renderLogs();
  });


  document.getElementById('clearAllLogsBtn')!.addEventListener('click', () => {
    confirmClearAllLogs();
  });

  // ── Ürün Satış Verileri ────────────────────────

  document.getElementById('selectionProductSalesBtn')!.addEventListener('click', () => {
    showProductSalesScreen();
  });

  document.getElementById('productSalesBackBtn')!.addEventListener('click', () => {
    showSelectionScreen();
  });

  document.getElementById('themeToggleBtnProductSales')!.addEventListener('click', toggleTheme);

  document.querySelectorAll('#productSalesPeriodBtnGroup .period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#productSalesPeriodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      productSalesPeriod = (btn as HTMLElement).dataset.period!;
      productSalesDay    = null;
      productSalesMonth  = null;
      productSalesRelativeN = null; productSalesRelativeUnit = null;
      (document.getElementById('productSalesDayFilter')   as HTMLInputElement).value = '';
      (document.getElementById('productSalesMonthFilter') as HTMLInputElement).value = '';
      (document.getElementById('productSalesRelativeNInput') as HTMLInputElement).value = '';
      updateProductSalesFilterState();
      renderProductSalesTable();
    });
  });

  document.getElementById('productSalesDayFilter')!.addEventListener('change', (e: Event) => {
    productSalesDay = (e.target as HTMLInputElement).value || null;
    if (productSalesDay) {
      productSalesMonth  = null;
      productSalesPeriod = 'daily';
      productSalesRelativeN = null; productSalesRelativeUnit = null;
      document.querySelectorAll('#productSalesPeriodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
      const dailyBtn = document.querySelector('#productSalesPeriodBtnGroup [data-period="daily"]');
      if (dailyBtn) dailyBtn.classList.add('active');
      (document.getElementById('productSalesMonthFilter') as HTMLInputElement).value = '';
      (document.getElementById('productSalesRelativeNInput') as HTMLInputElement).value = '';
    }
    updateProductSalesFilterState();
    renderProductSalesTable();
  });

  document.getElementById('productSalesTodayBtn')!.addEventListener('click', () => {
    const t    = new Date();
    const yyyy = t.getFullYear();
    const mm   = String(t.getMonth() + 1).padStart(2, '0');
    const dd   = String(t.getDate()).padStart(2, '0');
    productSalesDay    = yyyy + '-' + mm + '-' + dd;
    productSalesMonth  = null;
    productSalesPeriod = 'daily';
    productSalesRelativeN = null; productSalesRelativeUnit = null;
    (document.getElementById('productSalesDayFilter')   as HTMLInputElement).value = productSalesDay;
    (document.getElementById('productSalesMonthFilter') as HTMLInputElement).value = '';
    (document.getElementById('productSalesRelativeNInput') as HTMLInputElement).value = '';
    document.querySelectorAll('#productSalesPeriodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
    const dailyBtn = document.querySelector('#productSalesPeriodBtnGroup [data-period="daily"]');
    if (dailyBtn) dailyBtn.classList.add('active');
    updateProductSalesFilterState();
    renderProductSalesTable();
  });

  document.getElementById('productSalesMonthFilter')!.addEventListener('change', (e: Event) => {
    productSalesMonth = (e.target as HTMLInputElement).value || null;
    if (productSalesMonth) {
      productSalesPeriod = 'monthly';
      productSalesRelativeN = null; productSalesRelativeUnit = null;
      document.querySelectorAll('#productSalesPeriodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
      const monthlyBtn = document.querySelector('#productSalesPeriodBtnGroup [data-period="monthly"]');
      if (monthlyBtn) monthlyBtn.classList.add('active');
      productSalesDay = null;
      (document.getElementById('productSalesDayFilter') as HTMLInputElement).value = '';
      (document.getElementById('productSalesRelativeNInput') as HTMLInputElement).value = '';
    }
    updateProductSalesFilterState();
    renderProductSalesTable();
  });

  document.getElementById('productSalesSearch')!.addEventListener('input', (e: Event) => {
    productSalesSearchQ = (e.target as HTMLInputElement).value;
    renderProductSalesTable();
  });

  document.getElementById('productSalesQtySort')!.addEventListener('click', () => {
    productSalesSortAsc = !productSalesSortAsc;
    renderProductSalesTable();
  });

  document.getElementById('exportProductSalesPdfBtn')!.addEventListener('click', () => {
    exportProductSalesPDF();
  });

  // ── Product Sales: Relative Filter ───────────
  function applyProductSalesRelative(): void {
    const n = parseInt((document.getElementById('productSalesRelativeNInput') as HTMLInputElement).value, 10);
    if (!n || n < 1) return;
    const unit = (document.getElementById('productSalesRelativeUnitSelect') as HTMLSelectElement).value;
    productSalesRelativeN    = n;
    productSalesRelativeUnit = unit;
    productSalesDay   = null; productSalesMonth = null;
    (document.getElementById('productSalesDayFilter')   as HTMLInputElement).value = '';
    (document.getElementById('productSalesMonthFilter') as HTMLInputElement).value = '';
    document.querySelectorAll('#productSalesPeriodBtnGroup .period-btn').forEach(b => b.classList.remove('active'));
    updateProductSalesFilterState();
    renderProductSalesTable();
  }
  document.getElementById('productSalesRelativeApply')!.addEventListener('click', applyProductSalesRelative);
  document.getElementById('productSalesRelativeNInput')!.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') applyProductSalesRelative();
  });

  document.getElementById('analyticsMockBtn')!.addEventListener('click', generateMockData);
  document.getElementById('productSalesMockBtn')!.addEventListener('click', generateMockData);

  // ── Stok Yönetimi ─────────────────────────────

  document.getElementById('selectionInventoryBtn')!.addEventListener('click', () => {
    showInventoryScreen();
  });

  document.getElementById('inventoryBackBtn')!.addEventListener('click', () => {
    showSelectionScreen();
  });

  document.getElementById('themeToggleBtnInventory')!.addEventListener('click', toggleTheme);

  document.getElementById('invSearch')!.addEventListener('input', (e: Event) => {
    invSearchQuery = (e.target as HTMLInputElement).value;
    renderInventoryTable();
  });

  document.getElementById('invAddNewBtn')!.addEventListener('click', openAddStockModal);

  document.getElementById('invModalSaveBtn')!.addEventListener('click', saveUpdateStock);
  document.getElementById('invModalCancelBtn')!.addEventListener('click', closeUpdateStockModal);
  document.getElementById('invModalCloseBtn')!.addEventListener('click',  closeUpdateStockModal);

  ['invModalNameInput', 'invModalCatInput', 'invModalQty', 'invModalMin'].forEach(id => {
    document.getElementById(id)!.addEventListener('keydown', (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') saveUpdateStock();
    });
  });

  document.getElementById('invModalOverlay')!.addEventListener('click', (e: MouseEvent) => {
    if (e.target === e.currentTarget) closeUpdateStockModal();
  });

});

