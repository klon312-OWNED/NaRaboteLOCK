#!/bin/bash
# ============================================================
#  Настройка прав доступа к файлу графика (Linux / Astra Linux)
# ============================================================
#  Запускать от имени root: sudo bash setup_linux.sh
#
#  Логика:
#    - Создаётся группа «booking» (если не существует)
#    - Папка data/ принадлежит руководителю и группе booking
#    - Руководитель: полный доступ (rwx)
#    - Группа booking: чтение и запись (rw) — для приложения
#    - Остальные: нет доступа
# ============================================================

set -e

# --- Настройки (измените под свою среду) ---
MANAGER_USER="ivanov"        # Имя пользователя-руководителя
APP_DIR="$(dirname "$0")/.."
DATA_DIR="$APP_DIR/data"
GROUP_NAME="booking"

echo ""
echo "=== Настройка прав доступа ==="
echo "Папка данных: $DATA_DIR"
echo "Руководитель: $MANAGER_USER"
echo "Группа:       $GROUP_NAME"
echo ""

# Создаём группу если не существует
if ! getent group "$GROUP_NAME" > /dev/null 2>&1; then
    groupadd "$GROUP_NAME"
    echo "Создана группа: $GROUP_NAME"
fi

# Добавляем руководителя в группу
usermod -aG "$GROUP_NAME" "$MANAGER_USER"
echo "Пользователь $MANAGER_USER добавлен в группу $GROUP_NAME"

# Создаём папку если не существует
mkdir -p "$DATA_DIR"

# Устанавливаем владельца и группу
chown "$MANAGER_USER":"$GROUP_NAME" "$DATA_DIR"

# Права: владелец rwx, группа rwx, остальные — нет доступа
chmod 770 "$DATA_DIR"

# Права на файлы внутри
if [ -f "$DATA_DIR/schedule.xlsx" ]; then
    chown "$MANAGER_USER":"$GROUP_NAME" "$DATA_DIR/schedule.xlsx"
    chmod 660 "$DATA_DIR/schedule.xlsx"
    echo "Права на schedule.xlsx установлены"
fi

# Set-GID бит — новые файлы будут наследовать группу
chmod g+s "$DATA_DIR"

echo ""
echo "=== Готово ==="
echo "Руководитель ($MANAGER_USER): полный доступ к $DATA_DIR"
echo "Группа ($GROUP_NAME): чтение/запись"
echo "Остальные: нет доступа"
echo ""
echo "Чтобы добавить сотрудника для запуска приложения:"
echo "  sudo usermod -aG $GROUP_NAME <имя_пользователя>"
echo ""
