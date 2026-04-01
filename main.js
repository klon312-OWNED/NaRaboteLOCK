/* ============================================================
 *  Copyright (c) 2026 Антипин Андрей Александрович
 *  All rights reserved. See LICENSE file.
 * ============================================================
 *  ELECTRON — Главный процесс (main.js)
 * ============================================================
 *  Система учётных записей:
 *    • Администратор — логин/пароль, управление пользователями,
 *      сброс паролей, назначение ролей.
 *    • Руководитель — полный доступ ко всем + бронирование дат.
 *      Забронированные даты блокируют отпуск для всех.
 *    • Сотрудник — доступ только к СВОИМ данным (работа/отпуск),
 *      НЕ видит чужую статистику, НЕ может бронировать.
 *
 *  Регистрация — логин + пароль + имя (роль worker по умолчанию).
 * ============================================================ */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ScheduleManager = require('./lib/schedule');
const UserManager = require('./lib/users');

const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch (e) { console.error(e.message); }

const schedulePath = path.join(__dirname, config.scheduleFile || 'data/schedule.xlsx');
const usersPath = path.join(__dirname, config.usersFile || 'data/users.json');
const exportExcelPath = path.join(__dirname, config.exportExcel || 'data/export.xlsx');
const exportR7Path = path.join(__dirname, config.exportR7 || 'data/export.ods');
let schedule;
let users;
let mainWindow;

/* --- Сессия текущего пользователя --- */
let session = { type: null, empId: null, role: null };

function allowed(targetEmp) {
    if (session.type === 'admin') return true;
    if (session.role === 'manager') return true;
    return session.empId === targetEmp;
}
function isManagerOrAdmin() {
    return session.type === 'admin' || session.role === 'manager';
}

/* ======================= ОКНО =============================== */

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 860, minWidth: 900, minHeight: 650,
        title: 'Бронирование дат',
        webPreferences: {
            nodeIntegration: false, contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.setMenuBarVisibility(false);
}

/* =================== ИНИЦИАЛИЗАЦИЯ ========================== */

function initSchedule() {
    const dir = path.dirname(schedulePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    schedule = new ScheduleManager(schedulePath, config.maxPerDate || 2);
    if (!fs.existsSync(schedulePath)) {
        schedule.createEmpty();
        console.log('Создан файл:', schedulePath);
    }
    users = new UserManager(usersPath);
}

/* ======================= IPC ================================ */

/* --- Авторизация --- */
ipcMain.handle('admin-login', (ev, login, password) => {
    const res = users.adminLogin(login, password);
    if (res.success) session = { type: 'admin', empId: null, role: null };
    return res;
});

ipcMain.handle('user-login', (ev, login, password) => {
    const res = users.userLogin(login, password);
    if (res.success) session = { type: 'user', empId: res.empId, role: res.role };
    return res;
});

ipcMain.handle('register', (ev, login, password, displayName) => {
    return users.register(login, password, displayName);
});

ipcMain.handle('logout', () => {
    session = { type: null, empId: null, role: null };
    return { success: true };
});

ipcMain.handle('get-session', () => ({
    type: session.type, empId: session.empId, role: session.role,
    isAdmin: session.type === 'admin', isManager: isManagerOrAdmin()
}));

/* --- Конфигурация --- */
ipcMain.handle('get-config', () => ({ maxPerDate: config.maxPerDate || 2 }));

/* --- Управление пользователями (только админ) --- */
ipcMain.handle('list-users', () => ({ success: true, data: users.listUsers() }));

ipcMain.handle('set-role', (ev, empId, role) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.setRole(empId, role);
});

ipcMain.handle('rename-user', (ev, empId, newName) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.renameUser(empId, newName);
});

ipcMain.handle('delete-user', (ev, empId) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.deleteUser(empId);
});

ipcMain.handle('reset-password', (ev, empId, newPass) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.resetPassword(empId, newPass);
});

ipcMain.handle('change-admin-password', (ev, oldPass, newPass) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.changeAdminPassword(oldPass, newPass);
});

/* --- График (бронирование) — ТОЛЬКО руководитель/админ --- */
ipcMain.handle('load-schedule', () => {
    try { return { success: true, data: schedule.read() }; }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('book-date', (ev, dateStr, empId) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Бронирование доступно только руководителю/админу' };
    try { return schedule.book(dateStr, String(empId).trim()); }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('cancel-booking', (ev, dateStr, empId) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Отмена брони — только руководитель/админ' };
    try { return schedule.cancel(dateStr, String(empId).trim()); }
    catch (e) { return { success: false, message: e.message }; }
});

/* --- Рабочие дни --- */
ipcMain.handle('load-work', () => {
    try {
        let data = schedule.readWork();
        /* Работник видит только СВОИ данные */
        if (session.type === 'user' && session.role === 'worker') {
            data = data.filter(r => r.emp === session.empId);
        }
        return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('set-work', (ev, emp, date, start, end, lunch, rate) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try { return schedule.setWork(emp, date, start, end, lunch, rate); }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('remove-work', (ev, emp, date) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try { return schedule.removeWork(emp, date); }
    catch (e) { return { success: false, message: e.message }; }
});

/* --- Отпуск --- */
ipcMain.handle('load-vacation', () => {
    try {
        let data = schedule.readVacation();
        /* Работник видит только СВОИ */
        if (session.type === 'user' && session.role === 'worker') {
            data = data.filter(r => r.emp === session.empId);
        }
        return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('add-vacation', (ev, emp, date) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try {
        /* Проверка: дата забронирована → отпуск запрещён */
        const all = schedule.read();
        const rec = all.find(r => r.date === date);
        if (rec && (rec.emp1 || rec.emp2)) {
            return { success: false, message: 'Дата забронирована — отпуск невозможен' };
        }
        /* Проверка: макс. 2 совпадающих отпускных дня с любым другим сотрудником */
        const MAX_OVERLAP = config.maxPerDate || 2;
        const allVac = schedule.readVacation();
        const myVac = new Set(allVac.filter(r => r.emp === emp).map(r => r.date));
        myVac.add(date); // включая текущую дату
        const allEmps = schedule.getEmployees();
        for (const other of allEmps) {
            if (other === emp) continue;
            const otherVac = new Set(allVac.filter(r => r.emp === other).map(r => r.date));
            let overlap = 0;
            myVac.forEach(d => { if (otherVac.has(d)) overlap++; });
            if (overlap > MAX_OVERLAP) {
                return { success: false, message: 'Превышен лимит совпадений отпуска (' + MAX_OVERLAP + ' дн.) с ' + other };
            }
        }
        return schedule.addVacation(emp, date);
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('remove-vacation', (ev, emp, date) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try { return schedule.removeVacation(emp, date); }
    catch (e) { return { success: false, message: e.message }; }
});

/* --- Сотрудники --- */
ipcMain.handle('get-employees', () => {
    try {
        let data = schedule.getEmployees();
        /* Работник видит только себя */
        if (session.type === 'user' && session.role === 'worker') {
            data = data.includes(session.empId) ? [session.empId] : [session.empId];
        }
        return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
});

/* --- Массовая отмена бронирования (админ) --- */
ipcMain.handle('cancel-bookings-range', (ev, dateFrom, dateTo) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Только руководитель/админ' };
    try {
        const all = schedule.read();
        let count = 0;
        all.forEach(r => {
            if (r.date >= dateFrom && r.date <= dateTo) {
                // пропускаем — сортировка дат dd.mm.yyyy некорректна для > / <
            }
        });
        // Используем корректное сравнение дат
        const parse = s => { const [d,m,y] = s.split('.').map(Number); return new Date(y, m-1, d); };
        const dFrom = parse(dateFrom), dTo = parse(dateTo);
        for (const r of all) {
            const d = parse(r.date);
            if (d >= dFrom && d <= dTo && (r.emp1 || r.emp2)) {
                if (r.emp1) { schedule.cancel(r.date, r.emp1); count++; }
                // re-read after first cancel in case emp2 shifted
                const re = schedule.read().find(x => x.date === r.date);
                if (re && re.emp2) { schedule.cancel(r.date, re.emp2); count++; }
            }
        }
        return { success: true, message: 'Снято блокировок: ' + count };
    } catch (e) { return { success: false, message: e.message }; }
});

/* --- Экспорт --- */
ipcMain.handle('export-excel', (ev, breakType) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Только руководитель/админ' };
    try { return schedule.exportStructured(exportExcelPath, breakType); }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('export-r7', (ev, breakType) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Только руководитель/админ' };
    try { return schedule.exportStructured(exportR7Path, breakType); }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('open-export-folder', () => {
    const dir = path.dirname(exportExcelPath);
    if (fs.existsSync(dir)) shell.openPath(dir);
    return { success: true };
});

/* --- Диалог файла --- */
ipcMain.handle('select-file', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
        title: 'Выберите файл графика',
        filters: [{ name: 'Таблицы', extensions: ['xlsx', 'ods', 'xls'] }],
        properties: ['openFile']
    });
    return r.canceled ? null : r.filePaths[0];
});

/* ======================= ЗАПУСК ============================= */

app.whenReady().then(() => {
    initSchedule();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
