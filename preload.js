/* =============================================
   COFFEE SHOP POS — preload.ts
   ============================================= */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    toggleFullscreen: () => electron_1.ipcRenderer.send('toggle-fullscreen'),
    quitApp: () => electron_1.ipcRenderer.send('quit-app'),
    createShortcut: () => electron_1.ipcRenderer.invoke('create-shortcut'),
    focusWindow: () => electron_1.ipcRenderer.send('focus-window'),
    platform: process.platform,
    minimizeWindow: () => electron_1.ipcRenderer.send('window:minimize'),
    maximizeWindow: () => electron_1.ipcRenderer.send('window:maximize'),
    closeWindow: () => electron_1.ipcRenderer.send('window:close'),
    setCurrentUser: (u) => electron_1.ipcRenderer.send('session:set-user', u),
    onMaximizeChange: (cb) => {
        electron_1.ipcRenderer.on('window:maximized-change', (_e, val) => cb(val));
    },
});
electron_1.contextBridge.exposeInMainWorld('posDB', {
    getAllOrders: () => electron_1.ipcRenderer.invoke('db:getAllOrders'),
    getVisibleOrders: () => electron_1.ipcRenderer.invoke('db:getVisibleOrders'),
    hideOrder: (id) => electron_1.ipcRenderer.invoke('db:hideOrder', id),
    saveOrder: (sale) => electron_1.ipcRenderer.invoke('db:saveOrder', sale),
    clearAllOrders: () => electron_1.ipcRenderer.invoke('db:clearAllOrders'),
    exportCSV: (csv) => electron_1.ipcRenderer.invoke('db:exportCSV', csv),
    exportExcel: (html) => electron_1.ipcRenderer.invoke('db:exportExcel', html),
    exportPDF: (html) => electron_1.ipcRenderer.invoke('db:exportPDF', html),
    getUsers: () => electron_1.ipcRenderer.invoke('db:getUsers'),
    addUser: (u, p, r) => electron_1.ipcRenderer.invoke('db:addUser', u, p, r),
    updateUser: (id, u, p, r) => electron_1.ipcRenderer.invoke('db:updateUser', id, u, p, r),
    deleteUser: (id) => electron_1.ipcRenderer.invoke('db:deleteUser', id),
    addActivityLog: (userId, username, actionType, description, details) => electron_1.ipcRenderer.invoke('db:addActivityLog', userId, username, actionType, description, details !== null && details !== void 0 ? details : null),
    getActivityLogs: () => electron_1.ipcRenderer.invoke('db:getActivityLogs'),
    deleteActivityLog: (id) => electron_1.ipcRenderer.invoke('db:deleteActivityLog', id),
    clearActivityLogs: () => electron_1.ipcRenderer.invoke('db:clearActivityLogs'),
    getInventory: () => electron_1.ipcRenderer.invoke('db:getInventory'),
    upsertInventory: (name, qty, min, cat) => electron_1.ipcRenderer.invoke('db:upsertInventory', name, qty, min, cat),
    deductStock: (items) => electron_1.ipcRenderer.invoke('db:deductStock', items),
    restoreStock: (items) => electron_1.ipcRenderer.invoke('db:restoreStock', items),
    addStock: (name, qty, cat) => electron_1.ipcRenderer.invoke('db:addStock', name, qty, cat),
});
