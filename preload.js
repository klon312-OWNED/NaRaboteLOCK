/* ============================================================
 *  Copyright (c) 2026 Антипин Андрей Александрович
 *  All rights reserved. See LICENSE file.
 * ============================================================
 *  ELECTRON — Preload (preload.js)
 *  Безопасный мост: contextBridge + ipcRenderer.invoke
 *
 *  Учётные записи:
 *    • adminLogin / userLogin / register / logout / getSession
 *    • listUsers / setRole / renameUser / deleteUser / resetPassword (админ)
 *    • changeAdminPassword (админ)
 *  Права проверяются на бэкенде (main.js).
 * ============================================================ */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    /* Авторизация */
    adminLogin:    (login, pass)            => ipcRenderer.invoke('admin-login', login, pass),
    userLogin:     (login, pass)            => ipcRenderer.invoke('user-login', login, pass),
    register:      (login, pass, name)      => ipcRenderer.invoke('register', login, pass, name),
    logout:        ()                       => ipcRenderer.invoke('logout'),
    getSession:    ()                       => ipcRenderer.invoke('get-session'),

    /* Конфигурация */
    getConfig:    ()                        => ipcRenderer.invoke('get-config'),

    /* Управление пользователями (админ) */
    listUsers:    ()                        => ipcRenderer.invoke('list-users'),
    setRole:      (empId, role)             => ipcRenderer.invoke('set-role', empId, role),
    renameUser:   (empId, newName)          => ipcRenderer.invoke('rename-user', empId, newName),
    deleteUser:   (empId)                   => ipcRenderer.invoke('delete-user', empId),
    resetPassword:(empId, newPass)          => ipcRenderer.invoke('reset-password', empId, newPass),
    changeAdminPassword: (old, np)          => ipcRenderer.invoke('change-admin-password', old, np),

    /* График (бронирование) */
    loadSchedule: ()                        => ipcRenderer.invoke('load-schedule'),
    bookDate:     (d, e)                    => ipcRenderer.invoke('book-date', d, e),
    cancelBooking:(d, e)                    => ipcRenderer.invoke('cancel-booking', d, e),
    cancelBookingsRange: (from, to)         => ipcRenderer.invoke('cancel-bookings-range', from, to),

    /* Рабочие дни */
    loadWork:     ()                        => ipcRenderer.invoke('load-work'),
    setWork:      (emp, dt, s, e, l, r)     => ipcRenderer.invoke('set-work', emp, dt, s, e, l, r),
    removeWork:   (emp, dt)                 => ipcRenderer.invoke('remove-work', emp, dt),

    /* Отпуск */
    loadVacation: ()                        => ipcRenderer.invoke('load-vacation'),
    addVacation:  (emp, dt)                 => ipcRenderer.invoke('add-vacation', emp, dt),
    removeVacation:(emp, dt)                => ipcRenderer.invoke('remove-vacation', emp, dt),

    /* Сотрудники */
    getEmployees: ()                        => ipcRenderer.invoke('get-employees'),

    /* Экспорт */
    exportExcel:  (breakType)               => ipcRenderer.invoke('export-excel', breakType),
    exportR7:     (breakType)               => ipcRenderer.invoke('export-r7', breakType),
    openExportFolder: ()                    => ipcRenderer.invoke('open-export-folder'),

    /* Диалог */
    selectFile:   ()                        => ipcRenderer.invoke('select-file')
});
