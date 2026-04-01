@echo off
chcp 65001 >nul
REM ============================================================
REM  Настройка прав доступа к файлу графика (Windows)
REM ============================================================
REM  Запускать от имени Администратора!
REM
REM  Логика:
REM    - Папка data\ доступна для чтения/записи только
REM      пользователю-руководителю и самому приложению.
REM    - Обычные сотрудники НЕ могут открыть файл schedule.xlsx
REM      напрямую через проводник — только через приложение.
REM ============================================================

set APP_DIR=%~dp0..
set DATA_DIR=%APP_DIR%\data
set MANAGER_USER=%USERNAME%

echo.
echo === Настройка прав доступа ===
echo Папка данных: %DATA_DIR%
echo Руководитель: %MANAGER_USER%
echo.

REM Создаём папку если не существует
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM Сбрасываем унаследованные права
icacls "%DATA_DIR%" /inheritance:r

REM Полный доступ руководителю
icacls "%DATA_DIR%" /grant:r "%MANAGER_USER%:(OI)(CI)F"

REM Полный доступ для SYSTEM (нужен для работы приложения)
icacls "%DATA_DIR%" /grant:r "SYSTEM:(OI)(CI)F"

REM Полный доступ для Администраторов
icacls "%DATA_DIR%" /grant:r "Администраторы:(OI)(CI)F" 2>nul
icacls "%DATA_DIR%" /grant:r "Administrators:(OI)(CI)F" 2>nul

echo.
echo === Готово ===
echo Только %MANAGER_USER%, SYSTEM и Админ имеют доступ к %DATA_DIR%
echo Обычные сотрудники смогут работать только через приложение.
echo.
pause
