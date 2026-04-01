/* ============================================================
 *  Copyright (c) 2026 Антипин Андрей Александрович
 *  All rights reserved. See LICENSE file.
 * ============================================================
 *  НАРАБОТЕ — Клиентский скрипт (app.js)
 * ============================================================
 *  Роли:
 *    • Администратор — полный доступ, управление пользователями,
 *      сброс паролей, назначение ролей.
 *    • Руководитель — полный доступ ко всем данным, бронирование
 *      дат (забронированные даты блокируют отпуск для всех).
 *    • Сотрудник — только СВОИ данные, нет бронирования,
 *      не видит чужую статистику/пересечения.
 *
 *  Регистрация — логин + пароль + имя (роль worker по умолчанию).
 * ============================================================ */

(function () {
    'use strict';

    /* ==========================================================
     *  УТИЛИТЫ
     * ========================================================== */

    const $ = id => document.getElementById(id);
    function pad(n) { return n.toString().padStart(2, '0'); }
    function fk(d, m, y) { return pad(d) + '.' + pad(m + 1) + '.' + y; }
    function tH(t) { const p = t.split(':').map(Number); return p[0] + (p[1] || 0) / 60; }
    function sk(a) {
        return a.sort((x, y) => {
            const [d1, m1, y1] = x.split('.').map(Number);
            const [d2, m2, y2] = y.split('.').map(Number);
            return (y1 - y2) || (m1 - m2) || (d1 - d2);
        });
    }

    const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

    /* ==========================================================
     *  ПРОИЗВОДСТВЕННЫЙ КАЛЕНДАРЬ 2026
     * ========================================================== */

    const HOL = new Set([
        '01.01','02.01','03.01','04.01','05.01','06.01','07.01','08.01',
        '23.02','08.03','09.03','01.05','02.05','03.05',
        '09.05','10.05','11.05','12.06','13.06','14.06','04.11'
    ]);
    const PRE = new Set(['07.03','30.04','08.05','11.06','03.11','31.12']);

    function isH(dt) { return HOL.has(pad(dt.getDate()) + '.' + pad(dt.getMonth() + 1)); }
    function isW(dt) { const w = dt.getDay(); return w === 0 || w === 6; }
    function isP(dt) {
        const k = pad(dt.getDate()) + '.' + pad(dt.getMonth() + 1);
        return PRE.has(k) && !isW(dt) && !isH(dt);
    }

    /* ==========================================================
     *  СОСТОЯНИЕ
     * ========================================================== */

    const MAX_VAC_OVERLAP = 2;

    let config = {};
    let session = { type: null, empId: null, role: null };

    let employeeId = '';
    let viewingEmp = '';

    let scheduleData = [];
    let workData = [];
    let vacData = [];
    let tripData = [];
    let allEmployees = [];

    let curMonth = 3, curYear = 2026, selectedDate = null;
    /** Режим: 'book' | 'work' | 'vacation' */
    let markMode = 'work';
    /** Для Shift+Click выделения диапазона */
    let lastClickedDate = null;
    /** Лимит отпускных дней по ТК РФ */
    const VACATION_LIMIT = 28;
    /** Интервал автообновления (мс) */
    const RELOAD_INTERVAL = 3000;
    let reloadTimer = null;

    /* ==========================================================
     *  ВСПОМОГАТЕЛЬНЫЕ: права
     * ========================================================== */

    function isAdmin() { return session.type === 'admin'; }
    function isManagerOrAdmin() {
        return session.type === 'admin' || session.role === 'manager';
    }
    function isWorker() { return session.type === 'user' && session.role === 'worker'; }
    function canEdit() { return isManagerOrAdmin() || viewingEmp === employeeId; }

    /* ==========================================================
     *  ИНИЦИАЛИЗАЦИЯ
     * ========================================================== */

    async function init() {
        config = await window.api.getConfig();

        /* Табы авторизации */
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.auth-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                $('tab' + capitalize(tab.dataset.tab)).classList.add('active');
            };
        });

        $('loginEmpBtn').onclick = doLoginUser;
        $('loginUser').onkeydown = e => { if (e.key === 'Enter') doLoginUser(); };
        $('loginPass').onkeydown = e => { if (e.key === 'Enter') doLoginUser(); };
        $('registerBtn').onclick = doRegister;
        $('regPass').onkeydown = e => { if (e.key === 'Enter') doRegister(); };
        $('regName').onkeydown = e => { if (e.key === 'Enter') doRegister(); };
        $('loginAdminBtn').onclick = doLoginAdmin;
        $('adminPass').onkeydown = e => { if (e.key === 'Enter') doLoginAdmin(); };
        $('logoutBtn').onclick = doLogout;
        $('prevMonth').onclick = () => chMonth(-1);
        $('nextMonth').onclick = () => chMonth(1);
        $('modeBtn').onclick = toggleMode;
        $('modalCancel').onclick = hideModal;
        $('modalOverlay').onclick = e => { if (e.target === $('modalOverlay')) hideModal(); };
        $('expExcelBtn').onclick = expExcel;
        $('expR7Btn').onclick = expR7;
        $('openFolderBtn').onclick = () => window.api.openExportFolder();
        $('empSelector').onchange = onEmpSelectorChange;
        $('changePassBtn').onclick = doChangeAdminPass;
        $('bulkUnblockBtn').onclick = doBulkUnblock;
        $('todayBtn').onclick = goToday;
        $('themeBtn').onclick = toggleTheme;
        $('helpBtn').onclick = () => startTour();
        $('monthTitle').onclick = toggleMonthPicker;

        /* Автосохранение настроек */
        const SETTINGS_IDS = ['defStart','defEnd','defLunch','defNorm','defRate','defBreak'];
        restoreSettings();
        SETTINGS_IDS.forEach(id => {
            $(id).addEventListener('input', () => saveSettings());
            $(id).addEventListener('change', () => saveSettings());
        });

        /* Тема из localStorage */
        if (localStorage.getItem('narabote-theme') === 'light') document.body.classList.add('light-theme');

        /* Клавиатура: Escape закрывает модалку */
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') hideModal();
        });

        /* Закрытие пикера месяца по клику вне */
        document.addEventListener('click', e => {
            const mp = document.querySelector('.month-picker');
            if (mp && !mp.contains(e.target) && e.target !== $('monthTitle')) mp.remove();
        });
    }

    function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    /* ==========================================================
     *  АВТОРИЗАЦИЯ
     * ========================================================== */

    async function doLoginUser() {
        const login = $('loginUser').value.trim();
        const pass  = $('loginPass').value;
        if (!login || !pass) { showAuthErr('Введите логин и пароль'); return; }

        const res = await window.api.userLogin(login, pass);
        if (!res.success) { showAuthErr(res.message || 'Ошибка входа'); return; }

        /* Синхронизация сессии: берём роль с сервера для надёжности */
        const srv = await window.api.getSession();
        session = { type: srv.type || 'user', empId: srv.empId || res.empId, role: srv.role || res.role };
        employeeId = session.empId;
        viewingEmp = session.empId;
        enterApp();

        /* Уведомления о событиях с прошлого входа */
        if (res.notifications && res.notifications.length) {
            const n = res.notifications.length;
            toast('📢 ' + n + ' событий с последнего входа', 'info');
        }

        /* Инструкция при первом входе */
        const tourKey = 'narabote-tour-done-' + res.empId;
        if (!localStorage.getItem(tourKey)) {
            localStorage.setItem(tourKey, '1');
            setTimeout(() => startTour(), 600);
        }
    }

    async function doRegister() {
        const login = $('regLogin').value.trim();
        const pass  = $('regPass').value;
        const name  = $('regName').value.trim();
        if (!login || !pass) { showAuthErr('Заполните логин и пароль'); return; }

        const res = await window.api.register(login, pass, name);
        if (!res.success) { showAuthErr(res.message || 'Ошибка регистрации'); return; }

        toast('Регистрация успешна! Теперь войдите.', 'success');
        /* Переключаем на вкладку «Вход» */
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.auth-tab[data-tab="login"]').classList.add('active');
        $('tabLogin').classList.add('active');
        $('loginUser').value = login;
        $('loginPass').value = '';
        $('loginPass').focus();
    }

    async function doLoginAdmin() {
        const login = $('adminLogin').value.trim();
        const pass  = $('adminPass').value;
        if (!login || !pass) { showAuthErr('Введите логин и пароль'); return; }

        const res = await window.api.adminLogin(login, pass);
        if (!res.success) { showAuthErr(res.message || 'Неверный логин или пароль'); return; }

        session = { type: 'admin', empId: 'admin', role: 'admin' };
        employeeId = 'admin';
        viewingEmp = '';
        enterApp();
    }

    function enterApp() {
        $('authScreen').classList.remove('active');
        $('mainScreen').classList.add('active');
        $('userInfo').textContent = isAdmin() ? 'Администратор' : employeeId;

        const badge = $('roleBadge');
        if (isAdmin()) {
            badge.textContent = 'Админ'; badge.className = 'role-badge admin';
        } else if (session.role === 'manager') {
            badge.textContent = 'Руководитель'; badge.className = 'role-badge manager';
        } else {
            badge.textContent = 'Сотрудник'; badge.className = 'role-badge employee';
        }

        /* Панели доступа */
        $('managerPanel').style.display = isManagerOrAdmin() ? '' : 'none';
        $('empSelectorWrap').style.display = isManagerOrAdmin() ? '' : 'none';
        $('adminPanel').style.display = isAdmin() ? '' : 'none';
        $('exportBar').style.display = isManagerOrAdmin() ? '' : 'none';

        const now = new Date();
        curMonth = now.getMonth(); curYear = now.getFullYear();
        /* Работники не могут бронировать — стартуем с «РАБОТА» */
        markMode = isManagerOrAdmin() ? 'book' : 'work';
        updateModeBtn();
        loadAll();

        /* Автообновление — опрос каждые N сек для многопользовательской работы */
        if (reloadTimer) clearInterval(reloadTimer);
        reloadTimer = setInterval(autoReload, RELOAD_INTERVAL);
    }

    async function doLogout() {
        if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
        await window.api.logout();
        session = { type: null, empId: null, role: null };
        employeeId = ''; viewingEmp = ''; selectedDate = null;
        $('mainScreen').classList.remove('active');
        $('authScreen').classList.add('active');
        $('loginUser').value = ''; $('loginPass').value = '';
        $('adminLogin').value = ''; $('adminPass').value = '';
        $('regLogin').value = ''; $('regPass').value = ''; $('regName').value = '';
        $('loginUser').focus();
    }

    function showAuthErr(msg) {
        const el = $('authError'); el.textContent = msg; el.style.display = '';
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }

    /* ==========================================================
     *  СМЕНА ПАРОЛЯ АДМИНИСТРАТОРА
     * ========================================================== */

    async function doChangeAdminPass() {
        const old = $('oldAdminPass').value;
        const np  = $('newAdminPass').value;
        if (!old || !np) { toast('Заполните оба поля', 'error'); return; }
        const res = await window.api.changeAdminPassword(old, np);
        toast(res.message || (res.success ? 'Пароль изменён' : 'Ошибка'), res.success ? 'success' : 'error');
        if (res.success) { $('oldAdminPass').value = ''; $('newAdminPass').value = ''; }
    }

    function doBulkUnblock() {
        const fromVal = $('bulkUnblockFrom').value;
        const toVal = $('bulkUnblockTo').value;
        if (!fromVal || !toVal) { toast('Выберите обе даты', 'error'); return; }
        /* Конвертируем yyyy-mm-dd → dd.mm.yyyy */
        const from = fromVal.split('-').reverse().join('.');
        const to = toVal.split('-').reverse().join('.');
        $('modalTitle').textContent = 'Снятие блокировок';
        $('modalBody').innerHTML = 'Снять <b>все</b> блокировки с <b>' + from + '</b> по <b>' + to + '</b>?';
        showModal(async () => {
            const res = await window.api.cancelBookingsRange(from, to);
            if (res.success) {
                toast('Снято блокировок: ' + (res.count || 0), 'success');
                await loadAll();
            } else {
                toast(res.message || 'Ошибка', 'error');
            }
        });
    }

    /* ==========================================================
     *  ВЫБОР СОТРУДНИКА (руководитель / админ)
     * ========================================================== */

    function populateEmpSelector() {
        const sel = $('empSelector');
        const prev = sel.value;
        sel.innerHTML = '';
        allEmployees.forEach(emp => {
            const opt = document.createElement('option');
            opt.value = emp; opt.textContent = emp + (emp === employeeId ? ' (вы)' : '');
            sel.appendChild(opt);
        });
        if (allEmployees.includes(prev)) sel.value = prev;
        else if (allEmployees.includes(viewingEmp)) sel.value = viewingEmp;
        else if (allEmployees.length) { sel.value = allEmployees[0]; viewingEmp = allEmployees[0]; }
    }

    function onEmpSelectorChange() {
        viewingEmp = $('empSelector').value;
        selectedDate = null;
        $('dateContent').innerHTML = '<p class="hint">Кликните на дату в календаре</p>';
        renderAll();
    }

    /* ==========================================================
     *  ЗАГРУЗКА ДАННЫХ
     * ========================================================== */

    async function loadAll() {
        const [sRes, wRes, vRes, tRes, eRes] = await Promise.all([
            window.api.loadSchedule(), window.api.loadWork(),
            window.api.loadVacation(), window.api.loadTrips(), window.api.getEmployees()
        ]);
        scheduleData = sRes.success ? sRes.data : [];
        workData = wRes.success ? wRes.data : [];
        vacData = vRes.success ? vRes.data : [];
        tripData = tRes.success ? tRes.data : [];
        allEmployees = eRes.success ? eRes.data : [];
        if (employeeId && employeeId !== 'admin' && !allEmployees.includes(employeeId))
            allEmployees.push(employeeId);
        allEmployees.sort();

        if (isManagerOrAdmin()) {
            populateEmpSelector();
            if (!viewingEmp && allEmployees.length) viewingEmp = allEmployees[0];
        }

        renderAll();
        if (isAdmin()) renderAdminPanel();
    }

    function renderAll() {
        renderCalendar();
        renderDatesPanel();
        renderIntersections();
        renderStats();
        if (selectedDate) {
            renderDateDetails(selectedDate);
            if (isManagerOrAdmin()) renderManagerPanel(selectedDate);
        }
    }

    /* ==========================================================
     *  ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМА
     * ========================================================== */

    function toggleMode() {
        if (isWorker()) {
            if (markMode === 'work') markMode = 'vacation';
            else if (markMode === 'vacation') markMode = 'trip';
            else markMode = 'work';
        } else {
            if (markMode === 'book') markMode = 'work';
            else if (markMode === 'work') markMode = 'vacation';
            else if (markMode === 'vacation') markMode = 'trip';
            else markMode = 'book';
        }
        updateModeBtn();
        renderCalendar();
    }

    function updateModeBtn() {
        const btn = $('modeBtn');
        btn.classList.remove('active');
        if (markMode === 'work') { btn.textContent = '🔨 РАБОТА'; }
        else if (markMode === 'vacation') { btn.textContent = '🏖 ОТПУСК'; btn.classList.add('active'); }
        else if (markMode === 'trip') { btn.textContent = '✈ КОМАНДИРОВКА'; btn.classList.add('active'); }
        else { btn.textContent = '📋 БРОНЬ'; }
    }

    /* ==========================================================
     *  НАВИГАЦИЯ
     * ========================================================== */

    function chMonth(d) {
        curMonth += d;
        if (curMonth < 0) { curMonth = 11; curYear--; }
        else if (curMonth > 11) { curMonth = 0; curYear++; }
        selectedDate = null;
        $('dateContent').innerHTML = '<p class="hint">Кликните на дату в календаре</p>';
        renderCalendar();
    }

    function goToday() {
        const now = new Date();
        curMonth = now.getMonth();
        curYear = now.getFullYear();
        selectedDate = fk(now.getDate(), now.getMonth(), now.getFullYear());
        renderAll();
    }

    /* ==========================================================
     *  АВТОСОХРАНЕНИЕ НАСТРОЕК
     * ========================================================== */

    function saveSettings() {
        const data = {};
        ['defStart','defEnd','defLunch','defNorm','defRate','defBreak'].forEach(id => {
            data[id] = $(id).value;
        });
        localStorage.setItem('narabote-settings', JSON.stringify(data));
    }

    function restoreSettings() {
        try {
            const raw = localStorage.getItem('narabote-settings');
            if (!raw) return;
            const data = JSON.parse(raw);
            Object.entries(data).forEach(([id, val]) => {
                if ($(id)) $(id).value = val;
            });
        } catch (e) {}
    }

    /* ==========================================================
     *  АВТООБНОВЛЕНИЕ (многопользовательский режим)
     * ========================================================== */

    let _reloading = false;
    async function autoReload() {
        if (!session.type || _reloading) return;
        _reloading = true;
        try {
            /* Обновляем роль из серверной сессии (если админ сменил роль пока мы в системе) */
            const srv = await window.api.getSession();
            const roleChanged = srv.role && srv.role !== session.role;
            if (roleChanged) {
                session.role = srv.role;
                enterApp();          /* перерисовать интерфейс под новую роль */
                _reloading = false;
                return;
            }

            const [sRes, wRes, vRes, tRes, eRes] = await Promise.all([
                window.api.loadSchedule(), window.api.loadWork(),
                window.api.loadVacation(), window.api.loadTrips(), window.api.getEmployees()
            ]);
            const newSchedule = sRes.success ? sRes.data : [];
            const newWork = wRes.success ? wRes.data : [];
            const newVac = vRes.success ? vRes.data : [];
            const newTrips = tRes.success ? tRes.data : [];
            const newEmps = eRes.success ? eRes.data : [];

            /* Перерисовываем только если данные изменились */
            const changed = JSON.stringify(newSchedule) !== JSON.stringify(scheduleData) ||
                            JSON.stringify(newWork) !== JSON.stringify(workData) ||
                            JSON.stringify(newVac) !== JSON.stringify(vacData) ||
                            JSON.stringify(newTrips) !== JSON.stringify(tripData) ||
                            JSON.stringify(newEmps) !== JSON.stringify(allEmployees);
            if (changed) {
                scheduleData = newSchedule;
                workData = newWork;
                vacData = newVac;
                tripData = newTrips;
                allEmployees = newEmps;
                if (employeeId && employeeId !== 'admin' && !allEmployees.includes(employeeId))
                    allEmployees.push(employeeId);
                allEmployees.sort();
                if (isManagerOrAdmin()) {
                    populateEmpSelector();
                    if (!viewingEmp && allEmployees.length) viewingEmp = allEmployees[0];
                }
                renderAll();
                if (isAdmin()) renderAdminPanel();
            }
        } catch (e) {}
        _reloading = false;
    }

    function toggleTheme() {
        const light = document.body.classList.toggle('light-theme');
        localStorage.setItem('narabote-theme', light ? 'light' : 'dark');
    }

    /* ==========================================================
     *  ВЫБОР МЕСЯЦА ПО КЛИКУ
     * ========================================================== */

    function toggleMonthPicker() {
        let mp = document.querySelector('.month-picker');
        if (mp) { mp.remove(); return; }
        mp = document.createElement('div');
        mp.className = 'month-picker';
        renderMonthPicker(mp, curYear);
        $('monthTitle').parentNode.style.position = 'relative';
        $('monthTitle').parentNode.appendChild(mp);
    }

    function renderMonthPicker(mp, year) {
        const SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
        let html = '<div class="mp-year-row">';
        html += '<button class="nav-btn" style="width:28px;height:28px;font-size:13px" data-mp-y="-1">◀</button>';
        html += '<span class="mp-year">' + year + '</span>';
        html += '<button class="nav-btn" style="width:28px;height:28px;font-size:13px" data-mp-y="1">▶</button>';
        html += '</div><div class="mp-grid">';
        for (let i = 0; i < 12; i++) {
            const act = (i === curMonth && year === curYear) ? ' active' : '';
            html += '<div class="mp-cell' + act + '" data-mp-m="' + i + '" data-mp-yr="' + year + '">' + SHORT[i] + '</div>';
        }
        html += '</div>';
        mp.innerHTML = html;
        mp.querySelectorAll('[data-mp-y]').forEach(b => {
            b.onclick = e => { e.stopPropagation(); renderMonthPicker(mp, year + parseInt(b.dataset.mpY)); };
        });
        mp.querySelectorAll('[data-mp-m]').forEach(c => {
            c.onclick = e => {
                e.stopPropagation();
                curMonth = parseInt(c.dataset.mpM);
                curYear = parseInt(c.dataset.mpYr);
                selectedDate = null;
                mp.remove();
                renderAll();
            };
        });
    }

    /* ==========================================================
     *  ВСПОМОГАТЕЛЬНЫЕ: данные по сотруднику
     * ========================================================== */

    function empWork(emp) {
        const m = new Map();
        workData.filter(r => r.emp === emp).forEach(r => {
            m.set(r.date, { start: r.start, end: r.end, lunch: r.lunch, rate: r.rate });
        });
        return m;
    }

    function empVac(emp) {
        return new Set(vacData.filter(r => r.emp === emp).map(r => r.date));
    }

    function empTrip(emp) {
        return new Set(tripData.filter(r => r.emp === emp).map(r => r.date));
    }

    function vacOverlapCount(empA, empB) {
        const vA = empVac(empA), vB = empVac(empB);
        let cnt = 0;
        vA.forEach(k => { if (vB.has(k)) cnt++; });
        return cnt;
    }

    function vacBlocked(emp, k) {
        for (const other of allEmployees) {
            if (other === emp) continue;
            const oVac = empVac(other);
            if (!oVac.has(k)) continue;
            if (vacOverlapCount(emp, other) >= MAX_VAC_OVERLAP) return other;
        }
        return null;
    }

    /** Дата забронирована? (руководителем) */
    function isDateBooked(dateStr) {
        const rec = scheduleData.find(r => r.date === dateStr);
        return rec && (rec.emp1 || rec.emp2);
    }

    function calcFact(i) { return Math.max(0, tH(i.end) - tH(i.start) - i.lunch); }
    function calcNorm(i, k) {
        const dt = pkDate(k);
        const n = parseFloat($('defNorm').value) || 8;
        return isP(dt) ? (n - 1) * i.rate : n * i.rate;
    }
    function pkDate(k) { const [d, m, y] = k.split('.').map(Number); return new Date(y, m - 1, d); }

    /* ==========================================================
     *  РЕНДЕРИНГ: КАЛЕНДАРЬ
     * ========================================================== */

    function renderCalendar() {
        $('monthTitle').textContent = MONTHS[curMonth] + ' ' + curYear;
        const fd = new Date(curYear, curMonth, 1).getDay();
        const empt = fd === 0 ? 6 : fd - 1;
        const dim = new Date(curYear, curMonth + 1, 0).getDate();
        const today = new Date();
        const todayKey = fk(today.getDate(), today.getMonth(), today.getFullYear());

        const bookMap = {};
        scheduleData.forEach(r => { bookMap[r.date] = r; });

        const vWork = empWork(viewingEmp);
        const vVac  = empVac(viewingEmp);
        const vTrip = empTrip(viewingEmp);

        let html = '';
        for (let i = 0; i < empt; i++) html += '<div class="day-cell empty"></div>';

        for (let d = 1; d <= dim; d++) {
            const key = fk(d, curMonth, curYear);
            const dt = new Date(curYear, curMonth, d);
            const wknd = isW(dt), hol = isH(dt), pre = isP(dt);

            let cls = 'day-cell';
            if (hol) cls += ' holiday';
            else if (wknd) cls += ' weekend';
            else if (pre) cls += ' preholiday';
            if (key === todayKey) cls += ' today';
            if (key === selectedDate) cls += ' selected';

            const rec = bookMap[key];
            if (rec) {
                const isMine = rec.emp1 === viewingEmp || rec.emp2 === viewingEmp;
                const filled = (rec.emp1 ? 1 : 0) + (rec.emp2 ? 1 : 0);
                if (isMine) cls += ' mine';
                else if (filled >= (config.maxPerDate || 2)) cls += ' full';
                else if (filled > 0) cls += ' partial';
            }

            if (vWork.has(key)) cls += ' has-work';
            if (vVac.has(key)) cls += ' has-vac';
            if (vTrip.has(key)) cls += ' has-trip';

            /* Отпуск заблокирован: забронированная дата или превышен лимит пересечений */
            if (markMode === 'vacation' && !vVac.has(key)) {
                if (isDateBooked(key)) cls += ' vac-blocked';
                else if (vacBlocked(viewingEmp, key)) cls += ' vac-blocked';
            }

            /* Точки других сотрудников — только для руководителя/админа */
            let dots = '';
            let tooltip = key;
            if (isManagerOrAdmin()) {
                const othersWork = allEmployees.filter(e => e !== viewingEmp && workData.some(w => w.emp === e && w.date === key));
                const othersVac  = allEmployees.filter(e => e !== viewingEmp && vacData.some(v => v.emp === e && v.date === key));
                if (othersWork.length || othersVac.length) {
                    dots = '<div class="dots-row">';
                    othersWork.forEach(() => { dots += '<div class="dot-s" style="background:var(--success)"></div>'; });
                    othersVac.forEach(() => { dots += '<div class="dot-s" style="background:var(--primary)"></div>'; });
                    dots += '</div>';
                }
                /* Тултип */
                const wHere = workData.filter(w => w.date === key).map(w => w.emp);
                const vHere = vacData.filter(v => v.date === key).map(v => v.emp);
                const tHere = tripData.filter(t => t.date === key).map(t => t.emp);
                if (wHere.length) tooltip += '\n🔨 ' + wHere.join(', ');
                if (vHere.length) tooltip += '\n🏖 ' + vHere.join(', ');
                if (tHere.length) tooltip += '\n✈ ' + tHere.join(', ');
                if (rec) {
                    const booked = [rec.emp1, rec.emp2].filter(Boolean);
                    if (booked.length) tooltip += '\n🔒 ' + booked.join(', ');
                }
            } else {
                if (vWork.has(key)) tooltip += '\n🔨 Рабочий день';
                if (vVac.has(key)) tooltip += '\n🏖 Отпуск';
                if (vTrip.has(key)) tooltip += '\n✈ Командировка';
            }

            html += '<div class="' + cls + '" data-date="' + key + '" title="' + tooltip.replace(/"/g, '&quot;') + '">' + d + dots + '</div>';
        }

        const tot = Math.ceil((empt + dim) / 7) * 7;
        for (let i = empt + dim; i < tot; i++) html += '<div class="day-cell empty"></div>';
        $('calGrid').innerHTML = html;

        document.querySelectorAll('.day-cell[data-date]').forEach(cell => {
            cell.onclick = (e) => handleDayClick(cell.dataset.date, cell, e);
        });
    }

    /* ==========================================================
     *  ОБРАБОТКА КЛИКА ПО ДНЮ
     * ========================================================== */

    /** Генерация диапазона дат dd.mm.yyyy между a и b (включительно), без выходных/праздников */
    function dateRange(a, b) {
        const pa = pkDate(a), pb = pkDate(b);
        const from = pa < pb ? pa : pb, to = pa < pb ? pb : pa;
        const result = [];
        const cur = new Date(from);
        while (cur <= to) {
            if (!isW(cur) && !isH(cur)) {
                result.push(fk(cur.getDate(), cur.getMonth(), cur.getFullYear()));
            }
            cur.setDate(cur.getDate() + 1);
        }
        return result;
    }

    async function handleDayClick(dateStr, cell, ev) {
        /* --- Shift+Click: выделить диапазон --- */
        if (ev && ev.shiftKey && lastClickedDate && lastClickedDate !== dateStr && (markMode === 'work' || markMode === 'vacation' || markMode === 'trip')) {
            if (!canEdit()) { toast('⛔ Нет прав', 'error'); return; }
            const range = dateRange(lastClickedDate, dateStr);
            if (!range.length) { toast('Нет рабочих дней в диапазоне', 'info'); return; }

            let added = 0, errors = 0;
            if (markMode === 'work') {
                const w = empWork(viewingEmp);
                const d = getDefaults();
                for (const k of range) {
                    if (w.has(k)) continue;
                    const res = await window.api.setWork(viewingEmp, k, d.start, d.end, d.lunch, d.rate);
                    if (res.success) added++; else errors++;
                }
                toast('Добавлено рабочих дней: ' + added + (errors ? ', ошибок: ' + errors : ''), added ? 'success' : 'error');
            } else if (markMode === 'vacation') {
                const v = empVac(viewingEmp);
                for (const k of range) {
                    if (v.has(k)) continue;
                    if (isDateBooked(k)) { errors++; continue; }
                    const res = await window.api.addVacation(viewingEmp, k);
                    if (res.success) added++; else errors++;
                }
                toast('Добавлено отпускных дней: ' + added + (errors ? ', пропущено: ' + errors : ''), added ? 'success' : 'error');
            } else if (markMode === 'trip') {
                const t = empTrip(viewingEmp);
                for (const k of range) {
                    if (t.has(k)) continue;
                    const res = await window.api.addTrip(viewingEmp, k);
                    if (res.success) added++; else errors++;
                }
                toast('Добавлено командировок: ' + added + (errors ? ', ошибок: ' + errors : ''), added ? 'success' : 'error');
            }
            lastClickedDate = dateStr;
            await loadAll();
            return;
        }

        lastClickedDate = dateStr;

        if (markMode === 'work') {
            if (!canEdit()) { toast('⛔ Нет прав на редактирование чужих данных', 'error'); return; }
            const w = empWork(viewingEmp);
            if (w.has(dateStr)) {
                const res = await window.api.removeWork(viewingEmp, dateStr);
                if (!res.success) { toast(res.message, 'error'); return; }
            } else {
                const d = getDefaults();
                const res = await window.api.setWork(viewingEmp, dateStr, d.start, d.end, d.lunch, d.rate);
                if (!res.success) { toast(res.message, 'error'); return; }
            }
            await loadAll();
            return;
        }

        if (markMode === 'vacation') {
            if (!canEdit()) { toast('⛔ Нет прав на редактирование чужих данных', 'error'); return; }
            const v = empVac(viewingEmp);
            if (v.has(dateStr)) {
                const res = await window.api.removeVacation(viewingEmp, dateStr);
                if (!res.success) { toast(res.message, 'error'); return; }
            } else {
                /* Проверка: дата забронирована */
                if (isDateBooked(dateStr)) {
                    toast('⛔ Дата забронирована — отпуск невозможен', 'error');
                    return;
                }
                const blocker = vacBlocked(viewingEmp, dateStr);
                if (blocker) {
                    toast('⛔ Нельзя: уже ' + MAX_VAC_OVERLAP + ' общих отпускных дня с ' + blocker, 'error');
                    return;
                }
                const res = await window.api.addVacation(viewingEmp, dateStr);
                if (!res.success) { toast(res.message, 'error'); return; }
            }
            await loadAll();
            return;
        }

        if (markMode === 'trip') {
            if (!canEdit()) { toast('⛔ Нет прав на редактирование чужих данных', 'error'); return; }
            const t = empTrip(viewingEmp);
            if (t.has(dateStr)) {
                const res = await window.api.removeTrip(viewingEmp, dateStr);
                if (!res.success) { toast(res.message, 'error'); return; }
            } else {
                const res = await window.api.addTrip(viewingEmp, dateStr);
                if (!res.success) { toast(res.message, 'error'); return; }
            }
            await loadAll();
            return;
        }

        /* Режим бронирования (только руководитель/админ) */
        selectedDate = dateStr;
        document.querySelectorAll('.day-cell.selected').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        renderDateDetails(dateStr);
        if (isManagerOrAdmin()) renderManagerPanel(dateStr);
    }

    function getDefaults() {
        return {
            start: $('defStart').value || '09:00',
            end: $('defEnd').value || '18:00',
            lunch: parseFloat($('defLunch').value) || 1,
            rate: parseFloat($('defRate').value) || 1
        };
    }

    /* ==========================================================
     *  ДЕТАЛИ ДАТЫ
     * ========================================================== */

    function renderDateDetails(dateStr) {
        const rec = scheduleData.find(r => r.date === dateStr);
        const emp1 = rec ? rec.emp1 : '', emp2 = rec ? rec.emp2 : '';
        const filled = (emp1 ? 1 : 0) + (emp2 ? 1 : 0);
        const max = config.maxPerDate || 2;
        let statusLabel, statusCls;
        if (filled === 0) { statusLabel = 'Свободно'; statusCls = 'free'; }
        else if (filled < max) { statusLabel = 'Частично'; statusCls = 'partial'; }
        else { statusLabel = 'Занято'; statusCls = 'full'; }

        const dt = pkDate(dateStr);
        const hol = isH(dt), pre = isP(dt), wknd = isW(dt);
        let dayType = hol ? '🔴 Праздник' : wknd ? '📅 Выходной' : pre ? '🟡 Предпраздничный' : '⬜ Рабочий';

        let html = '<div class="detail-date">📅 ' + dateStr + ' <span style="font-size:11px;color:var(--text2)">' + dayType + '</span></div>';

        if (isManagerOrAdmin()) {
            /* Руководитель/админ видят полную информацию о бронировании */
            if (filled > 0) {
                html += '<div class="detail-status ' + statusCls + '">🔒 Забронировано (' + filled + '/' + max + ')</div>';
                if (emp1) html += '<div class="detail-emp"><span class="detail-emp-num">' + emp1 + '</span>' +
                    ' <button class="btn btn-danger btn-xs" data-cancel-d="' + dateStr + '" data-cancel-e="' + emp1 + '">Снять</button></div>';
                if (emp2) html += '<div class="detail-emp"><span class="detail-emp-num">' + emp2 + '</span>' +
                    ' <button class="btn btn-danger btn-xs" data-cancel-d="' + dateStr + '" data-cancel-e="' + emp2 + '">Снять</button></div>';
            } else {
                html += '<div class="detail-status ' + statusCls + '">' + statusLabel + '</div>';
            }

            const wHere = workData.filter(w => w.date === dateStr);
            const vHere = vacData.filter(v => v.date === dateStr);
            const tHere = tripData.filter(t => t.date === dateStr);
            if (wHere.length) html += '<div style="margin-top:6px;font-size:11px;color:var(--success)">🔨 Работают: ' + wHere.map(w => w.emp).join(', ') + '</div>';
            if (vHere.length) html += '<div style="font-size:11px;color:var(--primary)">🏖 Отпуск: ' + vHere.map(v => v.emp).join(', ') + '</div>';
            if (tHere.length) html += '<div style="font-size:11px;color:var(--warning)">✈ Командировка: ' + tHere.map(t => t.emp).join(', ') + '</div>';

            /* Кнопка бронирования */
            const alreadyBooked = emp1 === viewingEmp || emp2 === viewingEmp;
            if (filled < max && !alreadyBooked) {
                html += '<div class="book-btn-wrap"><button class="btn btn-primary btn-sm" id="bookBtn">📝 Забронировать ' + viewingEmp + ' на ' + dateStr + '</button></div>';
            } else if (alreadyBooked) {
                html += '<div class="book-btn-wrap"><p class="hint">✅ ' + viewingEmp + ' уже записан(а)</p></div>';
            } else {
                html += '<div class="book-btn-wrap"><p class="hint">⛔ Все слоты заняты</p></div>';
            }
        } else {
            /* Работник: никаких кнопок бронирования, только статус */
            if (filled > 0) {
                html += '<div style="font-size:12px;color:var(--warning);margin:6px 0">🔒 Дата заблокирована руководителем — отпуск недоступен</div>';
            } else {
                html += '<div class="detail-status ' + statusCls + '">' + statusLabel + '</div>';
            }
        }

        $('dateContent').innerHTML = html;
        const bookBtn = $('bookBtn');
        if (bookBtn) bookBtn.onclick = () => confirmBooking(dateStr);
        /* Кнопки «Снять» бронь */
        $('dateContent').querySelectorAll('[data-cancel-d]').forEach(btn => {
            btn.onclick = () => confirmCancel(btn.dataset.cancelD, btn.dataset.cancelE);
        });
    }

    /* ==========================================================
     *  ПАНЕЛЬ ДАТ (рабочие + отпуск viewingEmp)
     * ========================================================== */

    function renderDatesPanel() {
        const w = empWork(viewingEmp);
        const v = empVac(viewingEmp);
        const label = isManagerOrAdmin() && viewingEmp !== employeeId
            ? '📋 Дни: ' + viewingEmp
            : '📋 Мои дни';
        $('datesPanel').querySelector('.card-title').textContent = label;
        $('dayCounts').textContent = w.size + ' раб. / ' + v.size + ' отп. / ' + empTrip(viewingEmp).size + ' ком.';

        const editable = canEdit();
        let html = '';

        if (w.size) {
            const keys = sk(Array.from(w.keys()));
            let tN = 0, tF = 0;
            html += '<table class="wt"><thead><tr><th>Дата</th><th>Начало</th><th>Конец</th><th>Обед</th><th>Ставка</th><th>Норма</th><th>Факт</th>';
            if (editable) html += '<th></th>';
            html += '</tr></thead><tbody>';
            keys.forEach(k => {
                const i = w.get(k), n = calcNorm(i, k), f = calcFact(i);
                tN += n; tF += f;
                const pr = isP(pkDate(k)), df = f - n, fc = df >= 0 ? 'fp' : 'fn';
                html += '<tr><td>' + k + (pr ? '<span class="pptag">ПП</span>' : '') + '</td>';
                if (editable) {
                    html += '<td><input class="ti" type="time" value="' + i.start + '" data-k="' + k + '" data-f="start"></td>';
                    html += '<td><input class="ti" type="time" value="' + i.end + '" data-k="' + k + '" data-f="end"></td>';
                    html += '<td><input class="ti" type="number" value="' + i.lunch + '" step="0.5" min="0" max="3" data-k="' + k + '" data-f="lunch"></td>';
                    html += '<td><input class="ti" type="number" value="' + i.rate + '" step="0.05" min="0.1" max="2" data-k="' + k + '" data-f="rate"></td>';
                } else {
                    html += '<td>' + i.start + '</td><td>' + i.end + '</td><td>' + i.lunch + '</td><td>' + i.rate + '</td>';
                }
                html += '<td class="nv">' + n.toFixed(2) + '</td><td class="' + fc + '">' + f.toFixed(2) + '</td>';
                if (editable) html += '<td><button class="xbtn" data-wk="' + k + '">✕</button></td>';
                html += '</tr>';
            });
            const td2 = tF - tN, tc = td2 >= 0 ? 'fp' : 'fn';
            html += '<tr class="trow"><td colspan="5" style="text-align:right">ИТОГО:</td>';
            html += '<td>' + tN.toFixed(2) + '</td><td class="' + tc + '">' + tF.toFixed(2) + '</td>';
            if (editable) html += '<td></td>';
            html += '</tr></tbody></table>';
        } else {
            html += '<p class="hint">Нет рабочих дней</p>';
        }

        html += '<div class="vac-section"><div class="vac-title">🏖 Отпускные дни (' + v.size + '):</div>';
        if (v.size) {
            sk(Array.from(v)).forEach(k => {
                html += '<span class="vac-item">' + k;
                if (editable) html += ' <button class="vac-del" data-vk="' + k + '">✕</button>';
                html += '</span>';
            });
        } else {
            html += '<p class="hint">нет отпускных дней</p>';
        }
        html += '</div>';

        const tr = empTrip(viewingEmp);
        html += '<div class="vac-section"><div class="vac-title" style="color:var(--warning)">✈ Командировки (' + tr.size + '):</div>';
        if (tr.size) {
            sk(Array.from(tr)).forEach(k => {
                html += '<span class="vac-item">' + k;
                if (editable) html += ' <button class="vac-del" data-tk="' + k + '">✕</button>';
                html += '</span>';
            });
        } else {
            html += '<p class="hint">нет командировок</p>';
        }
        html += '</div>';

        $('datesContent').innerHTML = html;

        if (!editable) return;

        $('datesContent').querySelectorAll('.ti').forEach(inp => {
            inp.onchange = async () => {
                const k = inp.dataset.k;
                const w2 = empWork(viewingEmp);
                const i = w2.get(k);
                if (!i) return;
                const f = inp.dataset.f;
                if (f === 'start' || f === 'end') i[f] = inp.value;
                else i[f] = parseFloat(inp.value) || 0;
                const res = await window.api.setWork(viewingEmp, k, i.start, i.end, i.lunch, i.rate);
                if (!res.success) toast(res.message, 'error');
                await loadAll();
            };
        });

        $('datesContent').querySelectorAll('.xbtn[data-wk]').forEach(b => {
            b.onclick = async () => {
                const res = await window.api.removeWork(viewingEmp, b.dataset.wk);
                if (!res.success) toast(res.message, 'error');
                await loadAll();
            };
        });

        $('datesContent').querySelectorAll('.vac-del[data-vk]').forEach(b => {
            b.onclick = async () => {
                const res = await window.api.removeVacation(viewingEmp, b.dataset.vk);
                if (!res.success) toast(res.message, 'error');
                await loadAll();
            };
        });

        $('datesContent').querySelectorAll('.vac-del[data-tk]').forEach(b => {
            b.onclick = async () => {
                const res = await window.api.removeTrip(viewingEmp, b.dataset.tk);
                if (!res.success) toast(res.message, 'error');
                await loadAll();
            };
        });
    }

    /* ==========================================================
     *  ПЕРЕСЕЧЕНИЯ — только для руководителя/админа
     * ========================================================== */

    function renderIntersections() {
        if (isWorker()) {
            $('intersections').innerHTML = '<p class="hint">Данные доступны только руководителю</p>';
            return;
        }
        let html = '';
        for (let i = 0; i < allEmployees.length; i++) {
            for (let j = i + 1; j < allEmployees.length; j++) {
                const a = allEmployees[i], b = allEmployees[j];
                const wA = empWork(a), wB = empWork(b);
                const common = [];
                wA.forEach((_, k) => { if (wB.has(k)) common.push(k); });
                if (common.length) {
                    html += '<div style="margin-bottom:3px">' + a + ' ↔ ' + b +
                        ' <span style="color:var(--success)">[🔨' + common.length + ']</span>: ' +
                        sk(common).join(', ') + '</div>';
                }
            }
        }
        for (let i = 0; i < allEmployees.length; i++) {
            for (let j = i + 1; j < allEmployees.length; j++) {
                const a = allEmployees[i], b = allEmployees[j];
                const vA = empVac(a), vB = empVac(b);
                const common = [];
                vA.forEach(k => { if (vB.has(k)) common.push(k); });
                if (common.length) {
                    html += '<div style="margin-bottom:3px">' + a + ' ↔ ' + b +
                        ' <span style="color:var(--primary)">[🏖' + common.length + ']</span>: ' +
                        sk(common).join(', ') + '</div>';
                }
            }
        }
        $('intersections').innerHTML = html || '<p class="hint">нет общих дат</p>';
    }

    /* ==========================================================
     *  СТАТИСТИКА — работник видит только себя
     * ========================================================== */

    function renderStats() {
        const showEmps = isWorker() ? allEmployees.filter(e => e === employeeId) : allEmployees;
        let gD = 0, gN = 0, gF = 0, gV = 0, gT = 0, rows = '';
        showEmps.forEach(emp => {
            const w = empWork(emp), v = empVac(emp), t = empTrip(emp);
            let tF = 0, tN = 0, rD = 0, pD = 0;
            w.forEach((i, k) => {
                const dt = pkDate(k), pr = isP(dt);
                if (pr) pD++; else rD++;
                tF += calcFact(i); tN += calcNorm(i, k);
            });
            const d = tF - tN, ds = d >= 0 ? '+' + d.toFixed(2) : d.toFixed(2);
            const dc = d >= 0 ? 'fp' : 'fn';
            const isViewing = emp === viewingEmp;
            rows += '<tr' + (isViewing ? ' style="background:rgba(74,124,255,0.08)"' : '') + '>';
            rows += '<td>' + emp + (isViewing ? ' ★' : '') + '</td><td>' + w.size + '</td><td>' + rD + '</td><td>' + pD + '</td>';
            rows += '<td class="nv">' + tN.toFixed(2) + '</td><td class="' + dc + '">' + tF.toFixed(2) + '</td>';
            rows += '<td class="' + dc + '">' + ds + '</td><td>' + v.size + '</td>';
            const vacLeft = VACATION_LIMIT - v.size;
            rows += '<td class="' + (vacLeft > 0 ? 'fp' : vacLeft === 0 ? 'nv' : 'fn') + '">' + vacLeft + '</td>';
            rows += '<td>' + t.size + '</td></tr>';
            gD += w.size; gN += tN; gF += tF; gV += v.size; gT += t.size;
        });

        if (!isWorker()) {
            const gd2 = gF - gN, gs = gd2 >= 0 ? '+' + gd2.toFixed(2) : gd2.toFixed(2);
            const gc = gd2 >= 0 ? 'fp' : 'fn';
            rows += '<tr class="trow"><td>ИТОГО</td><td>' + gD + '</td><td colspan="2">—</td>';
            rows += '<td>' + gN.toFixed(2) + '</td><td>' + gF.toFixed(2) + '</td><td class="' + gc + '">' + gs + '</td><td>' + gV + '</td><td>' + (VACATION_LIMIT * showEmps.length - gV) + '</td><td>' + gT + '</td></tr>';
        }

        $('statsContent').innerHTML =
            '<table class="st"><thead><tr><th>Сотрудник</th><th>Дн</th><th>Об</th><th>ПП</th>' +
            '<th>Норма</th><th>Факт</th><th>±</th><th>🏖</th><th>Ост.</th><th>✈</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    /* ==========================================================
     *  ПАНЕЛЬ РУКОВОДИТЕЛЯ
     * ========================================================== */

    function renderManagerPanel(dateStr) {
        const rec = scheduleData.find(r => r.date === dateStr);
        if (!rec || (!rec.emp1 && !rec.emp2)) {
            $('managerContent').innerHTML = '<p class="hint">На ' + dateStr + ' нет записей</p>';
            return;
        }
        let html = '<p style="font-size:12px;margin-bottom:6px">Записи на <b>' + dateStr + '</b>:</p>';
        [rec.emp1, rec.emp2].forEach(eid => {
            if (!eid) return;
            html += '<div class="mgr-record"><span>' + eid + '</span>' +
                '<button class="btn btn-danger btn-xs" data-cd="' + dateStr + '" data-ce="' + eid + '">Отменить</button></div>';
        });
        $('managerContent').innerHTML = html;
        $('managerContent').querySelectorAll('[data-cd]').forEach(btn => {
            btn.onclick = () => confirmCancel(btn.dataset.cd, btn.dataset.ce);
        });
    }

    /* ==========================================================
     *  ПАНЕЛЬ АДМИНИСТРАТОРА (со сбросом пароля)
     * ========================================================== */

    async function renderAdminPanel() {
        const res = await window.api.listUsers();
        if (!res.success) { $('adminUserList').innerHTML = '<p class="hint">Ошибка загрузки</p>'; return; }
        const users = res.data;

        if (!users.length) {
            $('adminUserList').innerHTML = '<p class="hint">Нет зарегистрированных сотрудников</p>';
            return;
        }

        let html = '<table class="admin-user-table"><thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Действия</th></tr></thead><tbody>';
        users.forEach(u => {
            html += '<tr>';
            html += '<td>' + escHtml(u.id) + '</td>';
            html += '<td>' + escHtml(u.name) + '</td>';
            html += '<td><select class="role-select" data-uid="' + escHtml(u.id) + '">';
            html += '<option value="worker"' + (u.role === 'worker' ? ' selected' : '') + '>Сотрудник</option>';
            html += '<option value="manager"' + (u.role === 'manager' ? ' selected' : '') + '>Руководитель</option>';
            html += '</select></td>';
            html += '<td class="admin-actions">';
            html += '<button class="btn btn-outline btn-xs" data-ren="' + escHtml(u.id) + '" title="Переименовать">✏️</button>';
            html += '<button class="btn btn-outline btn-xs" data-rp="' + escHtml(u.id) + '" title="Сбросить пароль">🔑</button>';
            html += '<button class="btn btn-danger btn-xs" data-del="' + escHtml(u.id) + '" title="Удалить">🗑</button>';
            html += '</td></tr>';
        });
        html += '</tbody></table>';
        $('adminUserList').innerHTML = html;

        /* Смена роли */
        $('adminUserList').querySelectorAll('.role-select').forEach(sel => {
            sel.onchange = async () => {
                const res = await window.api.setRole(sel.dataset.uid, sel.value);
                toast(res.message || (res.success ? 'Роль обновлена' : 'Ошибка'), res.success ? 'success' : 'error');
                if (res.success) await renderAdminPanel();
            };
        });

        /* Переименование */
        $('adminUserList').querySelectorAll('[data-ren]').forEach(btn => {
            btn.onclick = () => {
                const uid = btn.dataset.ren;
                const cur = users.find(u => u.id === uid);
                $('modalTitle').textContent = 'Переименование';
                $('modalBody').innerHTML = '<p>Новое имя для <b>' + escHtml(uid) + '</b>:</p>' +
                    '<input type="text" id="renameInput" class="si" value="' + escHtml(cur ? cur.name : uid) + '" style="width:100%;margin-top:6px">';
                showModal(async () => {
                    const val = $('renameInput').value.trim();
                    if (!val) return;
                    const res = await window.api.renameUser(uid, val);
                    toast(res.message || (res.success ? 'Переименовано' : 'Ошибка'), res.success ? 'success' : 'error');
                    if (res.success) await renderAdminPanel();
                });
            };
        });

        /* Сброс пароля */
        $('adminUserList').querySelectorAll('[data-rp]').forEach(btn => {
            btn.onclick = () => {
                const uid = btn.dataset.rp;
                $('modalTitle').textContent = 'Сброс пароля';
                $('modalBody').innerHTML = '<p>Новый пароль для <b>' + escHtml(uid) + '</b>:</p>' +
                    '<input type="password" id="resetPassInput" class="si" placeholder="Новый пароль" style="width:100%;margin-top:6px">';
                showModal(async () => {
                    const val = $('resetPassInput').value.trim();
                    if (!val) { toast('Пароль не может быть пустым', 'error'); return; }
                    const res = await window.api.resetPassword(uid, val);
                    toast(res.message || (res.success ? 'Пароль сброшен' : 'Ошибка'), res.success ? 'success' : 'error');
                });
            };
        });

        /* Удаление */
        $('adminUserList').querySelectorAll('[data-del]').forEach(btn => {
            btn.onclick = () => {
                const uid = btn.dataset.del;
                $('modalTitle').textContent = 'Удаление пользователя';
                $('modalBody').innerHTML = 'Удалить учётную запись <b>' + escHtml(uid) + '</b>?<br><span style="color:var(--danger);font-size:12px">Данные в графике сохранятся.</span>';
                showModal(async () => {
                    const res = await window.api.deleteUser(uid);
                    toast(res.message || (res.success ? 'Удалено' : 'Ошибка'), res.success ? 'success' : 'error');
                    if (res.success) await renderAdminPanel();
                });
            };
        });

        /* Журнал действий */
        renderAudit();
    }

    function escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ==========================================================
     *  ЖУРНАЛ ДЕЙСТВИЙ (АУДИТ) — только админ
     * ========================================================== */

    async function renderAudit() {
        if (!isAdmin()) return;
        const el = $('auditContent');
        if (!el) return;
        const res = await window.api.loadAudit();
        if (!res.success) { el.innerHTML = '<p class="hint">Ошибка загрузки</p>'; return; }
        const log = res.data;
        if (!log.length) { el.innerHTML = '<p class="hint">Журнал пуст</p>'; return; }
        let html = '';
        for (let i = log.length - 1; i >= Math.max(0, log.length - 50); i--) {
            const e = log[i];
            const ts = e.ts ? e.ts.replace('T', ' ').substring(0, 16) : '';
            html += '<div class="audit-row"><span class="audit-ts">' + escHtml(ts) + '</span>';
            html += '<span class="audit-action">' + escHtml(e.action) + '</span>';
            html += '<span class="audit-user">' + escHtml(e.user) + '</span>';
            html += '<span class="audit-details">' + escHtml(e.details || '') + '</span></div>';
        }
        el.innerHTML = html;
    }

    /* ==========================================================
     *  БРОНИРОВАНИЕ / ОТМЕНА
     * ========================================================== */

    function confirmBooking(dateStr) {
        $('modalTitle').textContent = 'Подтверждение бронирования';
        $('modalBody').innerHTML = 'Забронировать <b>' + viewingEmp + '</b> на <b>' + dateStr + '</b>?<br><span style="font-size:11px;color:var(--warning)">Отпуск на эту дату будет заблокирован для всех.</span>';
        showModal(async () => {
            const res = await window.api.bookDate(dateStr, viewingEmp);
            toast(res.message, res.success ? 'success' : 'error');
            if (res.success) await loadAll();
        });
    }

    function confirmCancel(dateStr, empId) {
        $('modalTitle').textContent = 'Отмена бронирования';
        $('modalBody').innerHTML = 'Отменить бронирование <b>' + empId + '</b> на <b>' + dateStr + '</b>?';
        showModal(async () => {
            const res = await window.api.cancelBooking(dateStr, empId);
            toast(res.message, res.success ? 'success' : 'error');
            if (res.success) await loadAll();
        });
    }

    /* ==========================================================
     *  ЭКСПОРТ
     * ========================================================== */

    async function expExcel() {
        const brk = $('defBreak').value || 'F130';
        const res = await window.api.exportExcel(brk);
        toast(res.message || 'Ошибка', res.success ? 'success' : 'error');
    }

    async function expR7() {
        const brk = $('defBreak').value || 'F130';
        const res = await window.api.exportR7(brk);
        toast(res.message || 'Ошибка', res.success ? 'success' : 'error');
    }

    /* ==========================================================
     *  МОДАЛКА
     * ========================================================== */

    let modalCb = null;
    function showModal(cb) {
        modalCb = cb;
        $('modalOverlay').classList.add('show');
        $('modalConfirm').onclick = async () => { hideModal(); if (modalCb) await modalCb(); };
    }
    function hideModal() { $('modalOverlay').classList.remove('show'); modalCb = null; }

    /* ==========================================================
     *  ТОСТЫ
     * ========================================================== */

    function toast(msg, type) {
        type = type || 'info';
        const el = document.createElement('div');
        el.className = 'toast ' + type; el.textContent = msg;
        $('toastContainer').appendChild(el);
        setTimeout(() => { el.style.animation = 'toastOut .3s ease-in forwards'; setTimeout(() => el.remove(), 300); }, 3000);
    }

    /* ==========================================================
     *  ИНСТРУКЦИЯ (ONBOARDING TOUR)
     * ========================================================== */

    const TOUR_STEPS = [
        {
            title: '👋 Добро пожаловать в НаРаботе!',
            text: 'Это краткая инструкция по работе с приложением. Вы можете пройти её повторно, нажав кнопку <b>❓</b> в правом верхнем углу.',
            target: null
        },
        {
            title: '📅 Календарь',
            text: 'Здесь отображаются все дни месяца. Цвета показывают рабочие дни, отпуска, праздники и бронирования. Кликните на название месяца — откроется быстрый выбор.',
            target: '#calGrid'
        },
        {
            title: '🔨 Переключатель режима',
            text: 'Нажимайте для переключения режимов:<br>• <b>РАБОТА</b> — клик ставит/убирает рабочий день<br>• <b>ОТПУСК</b> — добавляет отпускные дни<br>• <b>КОМАНДИРОВКА</b> — назначает командировки<br>• <b>БРОНЬ</b> — только для руководителей',
            target: '#modeBtn'
        },
        {
            title: '⇧ Выделение диапазона',
            text: 'Кликните на дату, затем <b>Shift+Click</b> на другую — все рабочие дни между ними будут заполнены автоматически (в любом режиме).',
            target: '#calGrid'
        },
        {
            title: '⚙ Настройки',
            text: 'Задайте значения по умолчанию: время начала/конца, обед, ставку. Настройки сохраняются автоматически для каждого компьютера.',
            target: '#settingsBar'
        },
        {
            title: '📋 Мои дни',
            text: 'Сводная таблица ваших рабочих дней, отпусков и командировок. Здесь же можно отредактировать время и удалить записи.',
            target: '#datesPanel'
        },
        {
            title: '📌 Детали даты',
            text: 'Кликните на дату в календаре — здесь появятся подробности: кто работает, бронирования, статус.',
            target: '#dateDetails'
        },
        {
            title: '⏱ Статистика',
            text: 'Общая таблица по всем сотрудникам: рабочие дни, нормо-часы, факт, отпуска, остаток отпуска и командировки.',
            target: '#statsContent'
        },
        {
            title: '📊 Экспорт',
            text: 'Выгрузка данных в <b>Excel (.xlsx)</b> или <b>Р7 (.ods)</b>. Кнопка «Папка» открывает каталог с файлами.',
            target: '.btn-bar'
        },
        {
            title: '🌓 Тема и помощь',
            text: '<b>🌓</b> — переключает тёмную/светлую тему<br><b>❓</b> — открывает эту инструкцию повторно',
            target: '#themeBtn'
        },
        {
            title: '🔄 Совместная работа',
            text: 'Данные обновляются автоматически каждые 3 секунды. Несколько человек могут работать одновременно — изменения подтягиваются в реальном времени.',
            target: null
        },
        {
            title: '✅ Готово!',
            text: 'Теперь вы знаете основы. Если что-то забудете — нажмите <b>❓</b> в шапке. Приятной работы!',
            target: null
        }
    ];

    let tourStep = 0;

    function startTour() {
        tourStep = 0;
        $('tourOverlay').classList.add('show');
        renderTourStep();
    }

    function endTour() {
        $('tourOverlay').classList.remove('show');
    }

    function renderTourStep() {
        const step = TOUR_STEPS[tourStep];
        $('tourTitle').innerHTML = step.title;
        $('tourText').innerHTML = step.text;
        $('tourStepNum').textContent = (tourStep + 1) + ' из ' + TOUR_STEPS.length;

        /* Точки */
        let dots = '';
        for (let i = 0; i < TOUR_STEPS.length; i++) {
            dots += '<div class="tour-dot' + (i === tourStep ? ' active' : '') + '"></div>';
        }
        $('tourDots').innerHTML = dots;

        /* Кнопки */
        $('tourPrev').style.display = tourStep === 0 ? 'none' : '';
        const isLast = tourStep === TOUR_STEPS.length - 1;
        $('tourNext').textContent = isLast ? 'Завершить ✓' : 'Далее ▶';
        $('tourSkip').style.display = isLast ? 'none' : '';

        $('tourNext').onclick = () => {
            if (isLast) { endTour(); return; }
            tourStep++;
            renderTourStep();
        };
        $('tourPrev').onclick = () => {
            if (tourStep > 0) { tourStep--; renderTourStep(); }
        };
        $('tourSkip').onclick = endTour;
        $('tourBackdrop').onclick = endTour;

        /* Подсветка целевого элемента */
        const hl = $('tourHighlight');
        const tt = $('tourTooltip');
        if (step.target) {
            const el = document.querySelector(step.target);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                /* Пересчитать позицию после завершения прокрутки */
                setTimeout(() => positionTourHighlight(el, hl, tt), 400);
            } else {
                hl.style.display = 'none';
                centerTooltip(tt);
            }
        } else {
            hl.style.display = 'none';
            centerTooltip(tt);
        }
    }

    function positionTourHighlight(el, hl, tt) {
        const rect = el.getBoundingClientRect();
        const pad = 6;
        hl.style.display = 'block';
        hl.style.left = (rect.left - pad) + 'px';
        hl.style.top = (rect.top - pad) + 'px';
        hl.style.width = (rect.width + pad * 2) + 'px';
        hl.style.height = (rect.height + pad * 2) + 'px';
        tt.style.transform = '';

        /* Позиция тултипа */
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceRight = window.innerWidth - rect.right;
        tt.style.left = '';
        tt.style.right = '';
        tt.style.top = '';
        tt.style.bottom = '';

        if (spaceBelow > 200) {
            tt.style.top = (rect.bottom + 16) + 'px';
            tt.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 400)) + 'px';
        } else if (rect.top > 200) {
            tt.style.bottom = (window.innerHeight - rect.top + 16) + 'px';
            tt.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 400)) + 'px';
        } else if (spaceRight > 400) {
            tt.style.top = Math.max(16, rect.top) + 'px';
            tt.style.left = (rect.right + 16) + 'px';
        } else {
            tt.style.top = Math.max(16, rect.top) + 'px';
            tt.style.right = (window.innerWidth - rect.left + 16) + 'px';
        }
    }

    function centerTooltip(tt) {
        tt.style.left = '50%';
        tt.style.top = '50%';
        tt.style.right = '';
        tt.style.bottom = '';
        tt.style.transform = 'translate(-50%, -50%)';
    }

    /* ==========================================================
     *  СТАРТ
     * ========================================================== */

    init();
})();
