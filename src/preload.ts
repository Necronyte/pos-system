/* =============================================
   COFFEE SHOP POS — preload.ts
   ============================================= */

'use strict';

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  toggleFullscreen: (): void            => ipcRenderer.send('toggle-fullscreen'),
  quitApp:          (): void            => ipcRenderer.send('quit-app'),
  createShortcut:   (): Promise<unknown> => ipcRenderer.invoke('create-shortcut'),
  focusWindow:      (): void            => ipcRenderer.send('focus-window'),
  platform:         process.platform,
  minimizeWindow:   (): void            => ipcRenderer.send('window:minimize'),
  maximizeWindow:   (): void            => ipcRenderer.send('window:maximize'),
  closeWindow:      (): void            => ipcRenderer.send('window:close'),
  setCurrentUser:   (u: string): void   => ipcRenderer.send('session:set-user', u),
  onMaximizeChange: (cb: (isMaximized: boolean) => void): void => {
    ipcRenderer.on('window:maximized-change', (_e, val: boolean) => cb(val));
  },
});

contextBridge.exposeInMainWorld('posDB', {
  getAllOrders:      (): Promise<unknown>              => ipcRenderer.invoke('db:getAllOrders'),
  getVisibleOrders: (): Promise<unknown>              => ipcRenderer.invoke('db:getVisibleOrders'),
  hideOrder:        (id: string): Promise<unknown>    => ipcRenderer.invoke('db:hideOrder', id),
  saveOrder:        (sale: unknown): Promise<unknown> => ipcRenderer.invoke('db:saveOrder', sale),
  clearAllOrders:   (): Promise<unknown>              => ipcRenderer.invoke('db:clearAllOrders'),
  exportCSV:      (csv: string): Promise<unknown>   => ipcRenderer.invoke('db:exportCSV', csv),
  exportExcel:    (html: string): Promise<unknown>  => ipcRenderer.invoke('db:exportExcel', html),
  exportPDF:      (html: string): Promise<unknown>  => ipcRenderer.invoke('db:exportPDF', html),
  getUsers:       (): Promise<unknown>                                               => ipcRenderer.invoke('db:getUsers'),
  addUser:        (u: string, p: string, r: string): Promise<unknown>               => ipcRenderer.invoke('db:addUser', u, p, r),
  updateUser:     (id: number, u: string, p: string, r: string): Promise<unknown>   => ipcRenderer.invoke('db:updateUser', id, u, p, r),
  deleteUser:     (id: number): Promise<unknown>                                     => ipcRenderer.invoke('db:deleteUser', id),
  addActivityLog:    (userId: number, username: string, actionType: string, description: string, details?: string | null): Promise<unknown> => ipcRenderer.invoke('db:addActivityLog', userId, username, actionType, description, details ?? null),
  getActivityLogs:   (): Promise<unknown>         => ipcRenderer.invoke('db:getActivityLogs'),
  deleteActivityLog: (id: number): Promise<unknown> => ipcRenderer.invoke('db:deleteActivityLog', id),
  clearActivityLogs: (): Promise<unknown>         => ipcRenderer.invoke('db:clearActivityLogs'),
  getInventory:      (): Promise<unknown>         => ipcRenderer.invoke('db:getInventory'),
  upsertInventory:   (name: string, qty: number, min: number, cat: string): Promise<unknown> => ipcRenderer.invoke('db:upsertInventory', name, qty, min, cat),
  deductStock:       (items: { name: string; qty: number }[]): Promise<unknown> => ipcRenderer.invoke('db:deductStock', items),
  restoreStock:      (items: { name: string; qty: number }[]): Promise<unknown> => ipcRenderer.invoke('db:restoreStock', items),
  addStock:          (name: string, qty: number, cat: string): Promise<unknown> => ipcRenderer.invoke('db:addStock', name, qty, cat),
});
