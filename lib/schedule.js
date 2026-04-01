/* ============================================================
 *  Copyright (c) 2026 Антипин Андрей Александрович
 *  All rights reserved. See LICENSE file.
 * ============================================================
 *  МЕНЕДЖЕР ГРАФИКА (lib/schedule.js)
 * ============================================================
 *  Чтение/запись таблицы: бронирование, рабочие дни, отпуск.
 *  Поддерживает .xlsx (Excel, Р7 Офис) и .ods.
 *
 *  Структура (3 листа):
 *    «График»:  A-Дата, B-Сотр.1, C-Сотр.2, D-Статус
 *    «Работа»:  A-Сотрудник, B-Дата, C-Начало, D-Конец, E-Обед, F-Ставка
 *    «Отпуск»:  A-Сотрудник, B-Дата
 * ============================================================ */

'use strict';

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

class ScheduleManager {

    constructor(filePath, maxPerDate = 2) {
        this.filePath = filePath;
        this.maxPerDate = maxPerDate;
        this.isOds = path.extname(filePath).toLowerCase() === '.ods';
    }

    /* --- Создание пустого файла с 3 листами --- */
    createEmpty() {
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet([['Дата', 'Сотрудник 1', 'Сотрудник 2', 'Статус']]);
        ws1['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws1, 'График');

        const ws2 = XLSX.utils.aoa_to_sheet([['Сотрудник', 'Дата', 'Начало', 'Конец', 'Обед', 'Ставка']]);
        ws2['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Работа');

        const ws3 = XLSX.utils.aoa_to_sheet([['Сотрудник', 'Дата']]);
        ws3['!cols'] = [{ wch: 18 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws3, 'Отпуск');

        this._write(wb);
    }

    /* ======================= ГРАФИК ========================== */

    read() {
        const wb = this._open();
        const ws = wb.Sheets['График'] || wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const result = [];
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || !row[0]) continue;
            const dateStr = this._dateVal(row[0]);
            const emp1 = row[1] ? String(row[1]).trim() : '';
            const emp2 = row[2] ? String(row[2]).trim() : '';
            const filled = (emp1 ? 1 : 0) + (emp2 ? 1 : 0);
            result.push({ date: dateStr, emp1, emp2,
                status: filled === 0 ? 'свободно' : filled < this.maxPerDate ? 'частично' : 'занято', row: i });
        }
        return result;
    }

    book(dateStr, employeeId) {
        if (!employeeId) return { success: false, message: 'Не указан табельный номер' };
        const wb = this._open();
        const sn = this._sn(wb, 'График');
        const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1 });
        let rowIdx = -1;
        for (let i = 1; i < data.length; i++) {
            if (!data[i] || !data[i][0]) continue;
            if (this._dateVal(data[i][0]) === dateStr) { rowIdx = i; break; }
        }
        if (rowIdx === -1) {
            data.push([dateStr, employeeId, '', 'частично']);
        } else {
            const row = data[rowIdx]; while (row.length < 4) row.push('');
            const e1 = String(row[1] || '').trim(), e2 = String(row[2] || '').trim();
            if (e1 === employeeId || e2 === employeeId) return { success: false, message: 'Вы уже записаны на эту дату' };
            if (e1 && e2) return { success: false, message: 'Дата уже занята двумя сотрудниками' };
            if (!e1) row[1] = employeeId; else row[2] = employeeId;
            const f = (row[1] ? 1 : 0) + (row[2] ? 1 : 0);
            row[3] = f >= this.maxPerDate ? 'занято' : 'частично';
        }
        this._saveSheet(wb, sn, data, [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]);
        return { success: true, message: 'Запись успешно добавлена' };
    }

    cancel(dateStr, employeeId) {
        const wb = this._open();
        const sn = this._sn(wb, 'График');
        const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1 });
        let found = false;
        for (let i = 1; i < data.length; i++) {
            if (!data[i] || !data[i][0]) continue;
            if (this._dateVal(data[i][0]) !== dateStr) continue;
            const row = data[i]; while (row.length < 4) row.push('');
            if (String(row[1]).trim() === employeeId) { row[1] = ''; found = true; }
            else if (String(row[2]).trim() === employeeId) { row[2] = ''; found = true; }
            if (found) {
                const f = (row[1] ? 1 : 0) + (row[2] ? 1 : 0);
                row[3] = f === 0 ? 'свободно' : f < this.maxPerDate ? 'частично' : 'занято';
                break;
            }
        }
        if (!found) return { success: false, message: 'Запись не найдена' };
        this._saveSheet(wb, sn, data, [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]);
        return { success: true, message: 'Бронь успешно отменена' };
    }

    /* =================== РАБОЧИЕ ДНИ ========================= */

    readWork() {
        const wb = this._open();
        if (!wb.Sheets['Работа']) return [];
        const data = XLSX.utils.sheet_to_json(wb.Sheets['Работа'], { header: 1 });
        const res = [];
        for (let i = 1; i < data.length; i++) {
            const r = data[i]; if (!r || !r[0]) continue;
            res.push({ emp: String(r[0]).trim(), date: this._dateVal(r[1]),
                start: String(r[2] || '09:00').trim(), end: String(r[3] || '18:00').trim(),
                lunch: parseFloat(r[4]) || 1, rate: parseFloat(r[5]) || 1 });
        }
        return res;
    }

    setWork(emp, dateStr, start, end, lunch, rate) {
        const wb = this._open();
        this._ensure(wb, 'Работа', ['Сотрудник', 'Дата', 'Начало', 'Конец', 'Обед', 'Ставка']);
        const data = XLSX.utils.sheet_to_json(wb.Sheets['Работа'], { header: 1 });
        let found = false;
        for (let i = 1; i < data.length; i++) {
            if (!data[i]) continue;
            if (String(data[i][0] || '').trim() === emp && this._dateVal(data[i][1]) === dateStr) {
                data[i] = [emp, dateStr, start, end, lunch, rate]; found = true; break;
            }
        }
        if (!found) data.push([emp, dateStr, start, end, lunch, rate]);
        this._saveSheet(wb, 'Работа', data, [{ wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }]);
        return { success: true };
    }

    removeWork(emp, dateStr) {
        const wb = this._open();
        if (!wb.Sheets['Работа']) return { success: false };
        const data = XLSX.utils.sheet_to_json(wb.Sheets['Работа'], { header: 1 });
        const nw = [data[0]]; let ok = false;
        for (let i = 1; i < data.length; i++) {
            if (!data[i]) continue;
            if (String(data[i][0] || '').trim() === emp && this._dateVal(data[i][1]) === dateStr) { ok = true; continue; }
            nw.push(data[i]);
        }
        this._saveSheet(wb, 'Работа', nw, [{ wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }]);
        return { success: ok };
    }

    /* ====================== ОТПУСК ============================ */

    readVacation() {
        const wb = this._open();
        if (!wb.Sheets['Отпуск']) return [];
        const data = XLSX.utils.sheet_to_json(wb.Sheets['Отпуск'], { header: 1 });
        const res = [];
        for (let i = 1; i < data.length; i++) {
            const r = data[i]; if (!r || !r[0]) continue;
            res.push({ emp: String(r[0]).trim(), date: this._dateVal(r[1]) });
        }
        return res;
    }

    addVacation(emp, dateStr) {
        const wb = this._open();
        this._ensure(wb, 'Отпуск', ['Сотрудник', 'Дата']);
        const data = XLSX.utils.sheet_to_json(wb.Sheets['Отпуск'], { header: 1 });
        for (let i = 1; i < data.length; i++) {
            if (!data[i]) continue;
            if (String(data[i][0] || '').trim() === emp && this._dateVal(data[i][1]) === dateStr)
                return { success: false, message: 'Уже есть отпуск на эту дату' };
        }
        data.push([emp, dateStr]);
        this._saveSheet(wb, 'Отпуск', data, [{ wch: 18 }, { wch: 14 }]);
        return { success: true, message: 'Отпускной день добавлен' };
    }

    removeVacation(emp, dateStr) {
        const wb = this._open();
        if (!wb.Sheets['Отпуск']) return { success: false };
        const data = XLSX.utils.sheet_to_json(wb.Sheets['Отпуск'], { header: 1 });
        const nw = [data[0]]; let ok = false;
        for (let i = 1; i < data.length; i++) {
            if (!data[i]) continue;
            if (String(data[i][0] || '').trim() === emp && this._dateVal(data[i][1]) === dateStr) { ok = true; continue; }
            nw.push(data[i]);
        }
        this._saveSheet(wb, 'Отпуск', nw, [{ wch: 18 }, { wch: 14 }]);
        return { success: ok };
    }

    /* ==================== СОТРУДНИКИ ========================= */

    getEmployees() {
        const s = new Set();
        this.read().forEach(r => { if (r.emp1) s.add(r.emp1); if (r.emp2) s.add(r.emp2); });
        this.readWork().forEach(r => { if (r.emp) s.add(r.emp); });
        this.readVacation().forEach(r => { if (r.emp) s.add(r.emp); });
        return Array.from(s).sort();
    }

    /* ==================== ЭКСПОРТ ============================ */

    /**
     * Экспорт в структурированный файл:
     *   Книга 1 — листы «Работа_Сотрудник» (по одному на каждого)
     *   Книга 2 — листы «Отпуск_Сотрудник» (по одному на каждого)
     * Файл перезаписывается на месте (не создаётся новый).
     */
    exportStructured(exportPath, breakType) {
        const employees = this.getEmployees();
        if (!employees.length) return { success: false, message: 'Нет данных для экспорта' };

        const wb = XLSX.utils.book_new();
        const work = this.readWork();
        const vac  = this.readVacation();

        /* --- Листы рабочих дней по сотрудникам --- */
        employees.forEach(emp => {
            const rows = work.filter(r => r.emp === emp);
            const aoa = [['Дата', 'Начало', 'Конец', 'Обед', 'Ставка', 'Перерыв']];
            rows.sort((a, b) => this._cmpDate(a.date, b.date));
            rows.forEach(r => { aoa.push([r.date, r.start, r.end, r.lunch, r.rate, breakType || '']); });
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }];
            XLSX.utils.book_append_sheet(wb, ws, ('Работа ' + emp).substring(0, 31));
        });

        /* --- Листы отпуска по сотрудникам --- */
        employees.forEach(emp => {
            const rows = vac.filter(r => r.emp === emp);
            const aoa = [['Дата']];
            rows.sort((a, b) => this._cmpDate(a.date, b.date));
            rows.forEach(r => { aoa.push([r.date]); });
            const ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = [{ wch: 14 }];
            XLSX.utils.book_append_sheet(wb, ws, ('Отпуск ' + emp).substring(0, 31));
        });

        const dir = path.dirname(exportPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ext = path.extname(exportPath).toLowerCase();
        XLSX.writeFile(wb, exportPath, { bookType: ext === '.ods' ? 'ods' : 'xlsx' });
        return { success: true, message: 'Файл обновлён: ' + exportPath, path: exportPath };
    }

    _cmpDate(a, b) {
        const [d1, m1, y1] = a.split('.').map(Number);
        const [d2, m2, y2] = b.split('.').map(Number);
        return (y1 - y2) || (m1 - m2) || (d1 - d2);
    }

    /* ==================== УТИЛИТЫ ============================= */

    _open() {
        if (!fs.existsSync(this.filePath)) this.createEmpty();
        return XLSX.readFile(this.filePath);
    }
    _sn(wb, name) { return wb.SheetNames.includes(name) ? name : wb.SheetNames[0]; }
    _ensure(wb, name, headers) {
        if (!wb.Sheets[name]) {
            const ws = XLSX.utils.aoa_to_sheet([headers]);
            XLSX.utils.book_append_sheet(wb, ws, name);
        }
    }
    _saveSheet(wb, name, data, cols) {
        const ws = XLSX.utils.aoa_to_sheet(data);
        if (cols) ws['!cols'] = cols;
        wb.Sheets[name] = ws;
        this._write(wb);
    }
    _write(wb) { XLSX.writeFile(wb, this.filePath, { bookType: this.isOds ? 'ods' : 'xlsx' }); }
    _dateVal(v) { return v instanceof Date ? this._fmtDate(v) : String(v || '').trim(); }
    _fmtDate(dt) {
        return dt.getDate().toString().padStart(2, '0') + '.' +
            (dt.getMonth() + 1).toString().padStart(2, '0') + '.' + dt.getFullYear();
    }
}

module.exports = ScheduleManager;
