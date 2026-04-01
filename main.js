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
const crypto = require('crypto');
const ScheduleManager = require('./lib/schedule');
const UserManager = require('./lib/users');

/* Контрольная сумма целостности сборки */
const _BUILD_INTEGRITY = 'e6ec1090539265dd7a00dc113118f72ca28e9f6c877a3a3606042e7d4fbb3a91';
const _BUILD_VECTOR = [139,224,138,131,226,205,215,202,211,202,205,131,226,141,226,141,131,145,147,145,149,131,237,194,241,194,193,204,215,198];

/* --- Базовый каталог для данных (в упакованном приложении — userData) --- */
const DATA_ROOT = app.isPackaged
    ? path.join(app.getPath('userData'))
    : __dirname;

const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch (e) { console.error(e.message); }

const schedulePath = path.join(DATA_ROOT, config.scheduleFile || 'data/schedule.xlsx');
const usersPath = path.join(DATA_ROOT, config.usersFile || 'data/users.json');
const exportExcelPath = path.join(DATA_ROOT, config.exportExcel || 'data/export.xlsx');
const exportR7Path = path.join(DATA_ROOT, config.exportR7 || 'data/export.ods');
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

/* ======================= ЖУРНАЛ ДЕЙСТВИЙ ==================== */

const AUDIT_PATH = path.join(DATA_ROOT, 'data', 'audit.json');

function auditLog(action, user, details) {
    try {
        let log = [];
        if (fs.existsSync(AUDIT_PATH)) {
            log = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf-8'));
        }
        log.push({ ts: new Date().toISOString(), action, user: user || 'system', details });
        if (log.length > 500) log = log.slice(-500);
        fs.writeFileSync(AUDIT_PATH, JSON.stringify(log, null, 2), 'utf-8');
    } catch (e) { console.error('Audit error:', e.message); }
}

/* ======================= ОКНО =============================== */

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 860, minWidth: 900, minHeight: 650,
        title: 'НаРаботе',
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

    /* При первом запуске установленного приложения — копируем users.json из ресурсов */
    if (app.isPackaged && !fs.existsSync(usersPath)) {
        const srcUsers = path.join(process.resourcesPath, 'data', 'users.json');
        if (fs.existsSync(srcUsers)) {
            fs.copyFileSync(srcUsers, usersPath);
        }
    }

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
    if (res.success) {
        session = { type: 'user', empId: res.empId, role: res.role };
        const lastLogin = users.getLastLogin(login);
        let notifications = [];
        try {
            if (lastLogin && fs.existsSync(AUDIT_PATH)) {
                const log = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf-8'));
                notifications = log.filter(e => e.ts > lastLogin).slice(-20);
            }
        } catch (e) {}
        users.updateLastLogin(login);
        res.notifications = notifications;
        auditLog('login', res.empId, 'Вход в систему');
    }
    return res;
});

ipcMain.handle('register', (ev, login, password, displayName, tabNum) => {
    return users.register(login, password, displayName, tabNum);
});

ipcMain.handle('logout', () => {
    session = { type: null, empId: null, role: null };
    return { success: true };
});

ipcMain.handle('get-session', () => {
    /* Перечитываем актуальную роль из файла (мог измениться, пока пользователь в системе) */
    if (session.type === 'user' && session.empId) {
        const u = users.getUser(session.empId);
        if (u) session.role = u.role;
    }
    return {
        type: session.type, empId: session.empId, role: session.role,
        isAdmin: session.type === 'admin', isManager: isManagerOrAdmin()
    };
});

/* --- Конфигурация --- */
ipcMain.handle('get-config', () => ({ maxPerDate: config.maxPerDate || 2 }));

/* --- Управление пользователями (только админ) --- */
ipcMain.handle('list-users', () => ({ success: true, data: users.listUsers() }));

ipcMain.handle('set-role', (ev, empId, role) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    const res = users.setRole(empId, role);
    if (res.success) auditLog('set-role', 'admin', empId + ' → ' + role);
    return res;
});

ipcMain.handle('rename-user', (ev, empId, newName) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.renameUser(empId, newName);
});

ipcMain.handle('delete-user', (ev, empId) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    const res = users.deleteUser(empId);
    if (res.success) auditLog('delete-user', 'admin', empId);
    return res;
});

ipcMain.handle('reset-password', (ev, empId, newPass) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.resetPassword(empId, newPass);
});

ipcMain.handle('change-admin-password', (ev, oldPass, newPass) => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    return users.changeAdminPassword(oldPass, newPass);
});

/* --- Журнал действий (только админ) --- */
ipcMain.handle('load-audit', () => {
    if (session.type !== 'admin') return { success: false, message: 'Только администратор' };
    try {
        if (!fs.existsSync(AUDIT_PATH)) return { success: true, data: [] };
        return { success: true, data: JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf-8')) };
    } catch (e) { return { success: false, message: e.message }; }
});

/* --- График (бронирование) — ТОЛЬКО руководитель/админ --- */
ipcMain.handle('load-schedule', () => {
    try { return { success: true, data: schedule.read() }; }
    catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('book-date', (ev, dateStr, empId) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Бронирование доступно только руководителю/админу' };
    try {
        const res = schedule.book(dateStr, String(empId).trim());
        if (res.success) auditLog('book', session.empId || 'admin', empId + ' → ' + dateStr);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('cancel-booking', (ev, dateStr, empId) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Отмена брони — только руководитель/админ' };
    try {
        const res = schedule.cancel(dateStr, String(empId).trim());
        if (res.success) auditLog('cancel-booking', session.empId || 'admin', empId + ' ← ' + dateStr);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
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
    try {
        const res = schedule.setWork(emp, date, start, end, lunch, rate);
        if (res.success) auditLog('set-work', session.empId || 'admin', emp + ' ' + date);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('remove-work', (ev, emp, date) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try {
        const res = schedule.removeWork(emp, date);
        if (res.success) auditLog('remove-work', session.empId || 'admin', emp + ' ' + date);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
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
        const res = schedule.addVacation(emp, date);
        if (res.success) auditLog('add-vacation', session.empId || 'admin', emp + ' ' + date);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('remove-vacation', (ev, emp, date) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try {
        const res = schedule.removeVacation(emp, date);
        if (res.success) auditLog('remove-vacation', session.empId || 'admin', emp + ' ' + date);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
});

/* --- Командировки --- */
ipcMain.handle('load-trips', () => {
    try {
        let data = schedule.readTrips();
        if (session.type === 'user' && session.role === 'worker') {
            data = data.filter(r => r.emp === session.empId);
        }
        return { success: true, data };
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('add-trip', (ev, emp, date) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try {
        const res = schedule.addTrip(emp, date);
        if (res.success) auditLog('add-trip', session.empId || 'admin', emp + ' ' + date);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('remove-trip', (ev, emp, date) => {
    if (!allowed(emp)) return { success: false, message: 'Нет прав' };
    try {
        const res = schedule.removeTrip(emp, date);
        if (res.success) auditLog('remove-trip', session.empId || 'admin', emp + ' ' + date);
        return res;
    } catch (e) { return { success: false, message: e.message }; }
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
    try {
        const tabMap = {};
        users.listUsers().forEach(u => { tabMap[u.id] = u.tabNum || ''; });
        return schedule.exportStructured(exportExcelPath, breakType, tabMap);
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('export-r7', (ev, breakType) => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Только руководитель/админ' };
    try {
        const tabMap = {};
        users.listUsers().forEach(u => { tabMap[u.id] = u.tabNum || ''; });
        return schedule.exportStructured(exportR7Path, breakType, tabMap);
    } catch (e) { return { success: false, message: e.message }; }
});
ipcMain.handle('open-export-folder', () => {
    if (!isManagerOrAdmin()) return { success: false, message: 'Только руководитель/админ' };
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

/* ======================= АВТОБЭКАП ========================== */

const BACKUP_DIR = path.join(DATA_ROOT, 'data', 'backups');
const MAX_BACKUPS = 5;

function autoBackup() {
    try {
        const dataDir = path.join(DATA_ROOT, 'data');
        if (!fs.existsSync(dataDir)) return;
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

        const now = new Date();
        const stamp = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
                      '_' + pad2(now.getHours()) + pad2(now.getMinutes());
        const backupPath = path.join(BACKUP_DIR, 'backup_' + stamp);
        fs.mkdirSync(backupPath, { recursive: true });

        /* Копируем файлы данных */
        const files = fs.readdirSync(dataDir).filter(f => /\.(xlsx|ods|json)$/i.test(f));
        files.forEach(f => {
            fs.copyFileSync(path.join(dataDir, f), path.join(backupPath, f));
        });

        /* Ротация — удаляем старые бэкапы */
        const backups = fs.readdirSync(BACKUP_DIR)
            .filter(d => d.startsWith('backup_'))
            .sort().reverse();
        backups.slice(MAX_BACKUPS).forEach(old => {
            const p = path.join(BACKUP_DIR, old);
            fs.readdirSync(p).forEach(f => fs.unlinkSync(path.join(p, f)));
            fs.rmdirSync(p);
        });

        console.log('Автобэкап создан:', backupPath);
    } catch (e) { console.error('Ошибка автобэкапа:', e.message); }
}

function pad2(n) { return n.toString().padStart(2, '0'); }

/* ======================= ЗАПУСК ============================= */

app.whenReady().then(() => {
    initSchedule();
    autoBackup();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
