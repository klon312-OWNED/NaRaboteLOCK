/* ============================================================
 *  Copyright (c) 2026 Антипин Андрей Александрович
 *  All rights reserved. See LICENSE file.
 * ============================================================
 *  МЕНЕДЖЕР ПОЛЬЗОВАТЕЛЕЙ (lib/users.js)
 * ============================================================
 *  Хранение: data/users.json
 *  Роли: worker (по умолчанию), manager (назначает админ)
 *  Каждый пользователь: login, password, name, role
 *  Администратор — отдельная учётная запись (логин + пароль).
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

class UserManager {

    constructor(filePath) {
        this.filePath = filePath;
        this._ensure();
    }

    _ensure() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(this.filePath)) {
            this._save({ admin: { login: 'admin', password: 'admin' }, users: {} });
            return;
        }
        /* Миграция: удаляем старые записи без пароля */
        const data = this._load();
        let dirty = false;
        for (const [id, u] of Object.entries(data.users)) {
            if (!u.password) { delete data.users[id]; dirty = true; }
        }
        if (dirty) this._save(data);
    }

    _load() { return JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); }
    _save(d) { fs.writeFileSync(this.filePath, JSON.stringify(d, null, 2), 'utf-8'); }

    /* ==================== АДМИН ============================== */

    adminLogin(login, password) {
        const data = this._load();
        if (data.admin.login === login && data.admin.password === password) return { success: true };
        return { success: false, message: 'Неверный логин или пароль администратора' };
    }

    changeAdminPassword(oldPass, newPass) {
        const data = this._load();
        if (data.admin.password !== oldPass) return { success: false, message: 'Неверный старый пароль' };
        if (!newPass || newPass.length < 3) return { success: false, message: 'Пароль слишком короткий (мин. 3)' };
        data.admin.password = newPass;
        this._save(data);
        return { success: true, message: 'Пароль администратора изменён' };
    }

    /* ==================== РЕГИСТРАЦИЯ / ВХОД ================= */

    register(login, password, displayName, tabNum) {
        login = String(login).trim();
        if (!login || login.length < 2) return { success: false, message: 'Логин: минимум 2 символа' };
        if (!password || password.length < 3) return { success: false, message: 'Пароль: минимум 3 символа' };
        const data = this._load();
        if (data.users[login]) return { success: false, message: 'Пользователь «' + login + '» уже существует' };
        data.users[login] = {
            name: String(displayName || login).trim(),
            password: password,
            role: 'worker',
            tabNum: String(tabNum || '').trim()
        };
        this._save(data);
        return { success: true, message: 'Регистрация успешна. Войдите в систему.' };
    }

    userLogin(login, password) {
        login = String(login).trim();
        if (!login) return { success: false, message: 'Введите логин' };
        if (!password) return { success: false, message: 'Введите пароль' };
        const data = this._load();
        const user = data.users[login];
        if (!user) return { success: false, message: 'Пользователь не найден' };
        if (user.password !== password) return { success: false, message: 'Неверный пароль' };
        return { success: true, empId: login, role: user.role, name: user.name, tabNum: user.tabNum || '' };
    }

    /* ==================== УПРАВЛЕНИЕ ========================= */

    getUser(empId) {
        const data = this._load();
        return data.users[String(empId).trim()] || null;
    }

    listUsers() {
        const data = this._load();
        return Object.entries(data.users).map(([id, u]) => ({
            id, name: u.name, role: u.role, tabNum: u.tabNum || ''
        })).sort((a, b) => a.id.localeCompare(b.id));
    }

    setRole(empId, role) {
        if (role !== 'worker' && role !== 'manager') return { success: false, message: 'Недопустимая роль' };
        const id = String(empId).trim();
        const data = this._load();
        if (!data.users[id]) return { success: false, message: 'Не найден: ' + id };
        data.users[id].role = role;
        this._save(data);
        return { success: true, message: id + ' → ' + (role === 'manager' ? 'руководитель' : 'сотрудник') };
    }

    renameUser(empId, newName) {
        const id = String(empId).trim();
        const data = this._load();
        if (!data.users[id]) return { success: false, message: 'Не найден' };
        data.users[id].name = String(newName).trim() || id;
        this._save(data);
        return { success: true };
    }

    deleteUser(empId) {
        const id = String(empId).trim();
        const data = this._load();
        if (!data.users[id]) return { success: false, message: 'Не найден' };
        delete data.users[id];
        this._save(data);
        return { success: true, message: 'Сотрудник ' + id + ' удалён' };
    }

    /** Сброс пароля пользователя (только для админа) */
    resetPassword(empId, newPassword) {
        const id = String(empId).trim();
        if (!newPassword || newPassword.length < 3) return { success: false, message: 'Пароль: минимум 3 символа' };
        const data = this._load();
        if (!data.users[id]) return { success: false, message: 'Не найден: ' + id };
        data.users[id].password = newPassword;
        this._save(data);
        return { success: true, message: 'Пароль сброшен для ' + id };
    }

    getLastLogin(login) {
        const data = this._load();
        const user = data.users[login];
        return user ? user.lastLogin || null : null;
    }

    updateLastLogin(login) {
        const data = this._load();
        if (data.users[login]) {
            data.users[login].lastLogin = new Date().toISOString();
            this._save(data);
        }
    }
}

module.exports = UserManager;
