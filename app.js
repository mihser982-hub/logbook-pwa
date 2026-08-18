// =========================
// 0) Вспомогательные функции для дат и форматов
// =========================

// Массив названий месяцев на русском в нужном порядке (январь — индекс 0)
const MONTH_NAMES = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

// Массив названий дней недели (воскресенье — индекс 0)
const WEEKDAY_NAMES = [
  'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'
];

// История навигации
const MAX_HISTORY = 10;
let backHistory = [];
let forwardHistory = [];

// =========================
// 0.1) Вспомогательные функции для календаря
// =========================

// Названия месяцев для селекта (январь–декабрь)
const MONTH_SELECT_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

// Названия дней недели для шапки календаря (Пн–Вс)
const WEEKDAY_HEADER_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Получить количество дней в месяце (month: 0–11, year: полный год)
function getDaysInMonth(month, year) {
  // new Date(year, month + 1, 0) — это последний день предыдущего месяца, т.е. month+1 = следующий месяц, день 0 = последний день предыдущего
  return new Date(year, month + 1, 0).getDate();
}

// Получить день недели (0–6) для 1-го числа месяца (month: 0–11, year: полный год)
// Возвращает: 0 = воскресенье, 1 = понедельник, ..., 6 = суббота
function getFirstDayWeekday(month, year) {
  return new Date(year, month, 1).getDay();
}

// Преобразовать день недели из формата JS (0=Вс, 1=Пн, ..., 6=Сб) в формат Пн=0, ..., Вс=6
function jsWeekdayToMonFirst(jsWeekday) {
  // Если jsWeekday === 0 (воскресенье), то в нашем формате это 6
  // Иначе сдвигаем на 1: Пн(1)→0, Вт(2)→1, ..., Сб(6)→5
  return (jsWeekday + 6) % 7;
}

// Сгенерировать заголовок ежедневной заметки по числовым частям даты
function formatDailyTitleFromParts(day, month, year) {
  const date = new Date(year, month, day);
  const weekday = date.getDay(); // 0–6 (0=Вс)
  return formatDailyTitle(day, month, year, weekday);
}

// Проверить, является ли заголовок заметки ежедневной (формат "DD month YYYY weekday")
function isDailyNoteTitle(title) {
  if (!title) return false;
  // Простая проверка: заголовок должен содержать пробелы и заканчиваться названием дня недели
  const parts = title.split(' ');
  if (parts.length < 4) return false;
  const lastPart = parts[parts.length - 1].toLowerCase();
  return WEEKDAY_NAMES.includes(lastPart);
}

// Извлечь дату из заголовка ежедневной заметки (возвращает { day, month, year } или null)
function parseDailyNoteTitle(title) {
  if (!isDailyNoteTitle(title)) return null;
  // Ожидаем формат: "DD month YYYY weekday"
  const parts = title.split(' ');
  if (parts.length < 4) return null;

  const dayStr = parts[0]; // "16" или "03"
  const monthName = parts[1].toLowerCase(); // "августа"
  const yearStr = parts[2]; // "2026"

  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);

  // Ищем индекс месяца по названию (в родительном падеже)
  const monthIndex = MONTH_NAMES.findIndex((m) => m === monthName);
  if (monthIndex === -1) return null;

  return { day, month: monthIndex, year };
}

// Получить множество дат (в формате "YYYY-MM-DD") для всех ежедневных заметок
async function getDailyNotesDatesSet() {
  const notes = await getAllNotes();
  const set = new Set();

  for (const note of notes) {
    const parsed = parseDailyNoteTitle(note.title);
    if (!parsed) continue;
    const { day, month, year } = parsed;
    // Формируем ключ "YYYY-MM-DD"
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    set.add(key);
  }

  return set;
}

// Форматируем дату в строку вида "16 августа 2026 воскресенье"
// day: число (1–31), month: 0–11, year: полный год, weekday: 0–6 (0 — воскресенье)
function formatDailyTitle(day, month, year, weekday) {
  // Добавляем ведущий ноль для дней 1–9, чтобы было "03", "07" и т.д.
  const dayStr = day < 10 ? '0' + day : String(day);
  const monthName = MONTH_NAMES[month];
  const weekdayName = WEEKDAY_NAMES[weekday];
  return `${dayStr} ${monthName} ${year} ${weekdayName}`;
}

// Получаем «сегодняшнюю» дату как объект { day, month, year, weekday }
function getTodayDateParts() {
  const now = new Date();
  return {
    day: now.getDate(),          // 1–31
    month: now.getMonth(),       // 0–11
    year: now.getFullYear(),     // например 2026
    weekday: now.getDay()        // 0–6 (0 — воскресенье)
  };
}

// Генерируем заголовок ежедневной заметки на сегодня
function getTodayDailyTitle() {
  const { day, month, year, weekday } = getTodayDateParts();
  return formatDailyTitle(day, month, year, weekday);
}

// =========================
// 0.2) Инициализация markdown-it
// =========================

// Создаём экземпляр markdown-it с включенными плагинами
const md = window.markdownit({
  html: false,          // отключаем HTML-теги в Markdown (безопасность)
  linkify: true,        // автоматически превращаем URL в ссылки
  typographer: true,    // улучшенная типографика (кавычки, тире и т.д.)
})
  .use(window.markdownitCheckbox) // чекбоксы - [ ] и - [x]
  .use(window.markdownitFootnote); // сноски [^1]

// =========================
// 1) IndexedDB: открытие базы и CRUD операции
// =========================

const DB_NAME = 'notes-pwa-db';
const DB_VERSION = 1;
const STORE_NAME = 'notes';

let db = null;

// Уникальный постоянный идентификатор заметки.
// Один раз создаётся для заметки и переносится между ПК, Android,
// резервными копиями и сервером синхронизации.
function createSyncId() {
  return crypto.randomUUID();
}

// Нормализует старую или новую заметку.
// Старым заметкам без syncId будет выдан новый постоянный идентификатор.
function normalizeNote(note) {
  const now = Date.now();

  return {
    ...note,
    syncId: note.syncId || createSyncId(),
    createdAt: Number(note.createdAt) || now,
    updatedAt: Number(note.updatedAt) || now
  };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

// Получить все заметки
async function getAllNotes() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Найти заметку по точному заголовку
async function findNoteByTitle(title) {
  const notes = await getAllNotes();
  // Ищем заметку, у которой title === искомому заголовку
  return notes.find((n) => n.title === title) || null;
}

async function saveNote(note) {
  const normalizedNote = normalizeNote(note);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(normalizedNote);

    request.onsuccess = () => {
      resolve({
        ...normalizedNote,
        id: request.result
      });
    };

    request.onerror = () => reject(request.error);
  });
}

// Один раз добавляет syncId старым заметкам.
// Ничего не удаляет и не меняет содержание заметок.
async function migrateExistingNotesForSync() {
  const notes = await getAllNotes();
  let migrated = 0;

  for (const note of notes) {
    if (note.syncId) continue;

    await saveNote({
      ...note,
      syncId: createSyncId(),
      createdAt: note.createdAt || Date.now(),
      updatedAt: note.updatedAt || Date.now()
    });

    migrated++;
  }

  if (migrated > 0) {
    console.log(`Подготовлено для синхронизации заметок: ${migrated}`);
  }
}

// Удалить заметку по id
async function deleteNoteById(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// =========================
// 1.1) Резервные копии: экспорт и импорт JSON
// =========================

function createBackupFileName() {
  const now = new Date();

  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');

  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('-');

  return `logbook-backup-${date}_${time}.json`;
}


// Экспортировать все заметки текущей базы в JSON-файл
async function exportBackup() {
  const notes = await getAllNotes();

  const backup = {
    app: 'LogBook',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = createBackupFileName();

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  alert(`Резервная копия создана.\n\nЗаметок: ${notes.length}`);
}


// Проверить, что JSON выглядит как резервная копия LogBook
function isValidBackup(backup) {
  return (
    backup &&
    typeof backup === 'object' &&
    backup.app === 'LogBook' &&
    Array.isArray(backup.notes)
  );
}


// Импортировать заметки из выбранного JSON-файла
async function importBackupFromFile(file) {
  if (!file) return;

  let backup;

  try {
    const text = await file.text();
    backup = JSON.parse(text);
  } catch (error) {
    console.error('Ошибка чтения резервной копии:', error);
    alert('Не удалось прочитать файл. Выберите корректную JSON-копию LogBook.');
    return;
  }

  if (!isValidBackup(backup)) {
    alert('Этот файл не похож на резервную копию LogBook.');
    return;
  }

  const incomingNotes = backup.notes.filter((note) => {
    return (
      note &&
      typeof note === 'object' &&
      typeof note.title === 'string' &&
      typeof note.body === 'string'
    );
  });

  if (incomingNotes.length === 0) {
    alert('В резервной копии нет заметок для импорта.');
    return;
  }

  const confirmed = confirm(
    `Импортировать ${incomingNotes.length} заметок?\n\n` +
    'Существующие заметки не удаляются. ' +
    'Если найдётся заметка с таким же заголовком, останется более новая версия.'
  );

  if (!confirmed) return;

  const existingNotes = await getAllNotes();
  const existingByTitle = new Map(
    existingNotes.map((note) => [note.title || '', note])
  );

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const incomingNote of incomingNotes) {
    const titleKey = incomingNote.title || '';
    const existingNote = existingByTitle.get(titleKey);

    const incomingUpdatedAt = Number(incomingNote.updatedAt || 0);

    if (!existingNote) {
      // ID не переносим: каждая IndexedDB создаёт свой числовой ID.
      const { id, ...noteWithoutId } = incomingNote;

      await saveNote({
        ...noteWithoutId,
        createdAt: noteWithoutId.createdAt || Date.now(),
        updatedAt: noteWithoutId.updatedAt || Date.now()
      });

      added++;
      continue;
    }

    const existingUpdatedAt = Number(existingNote.updatedAt || 0);

    if (incomingUpdatedAt > existingUpdatedAt) {
      await saveNote({
        ...incomingNote,
        id: existingNote.id,
        createdAt: existingNote.createdAt || incomingNote.createdAt || Date.now(),
        updatedAt: incomingNote.updatedAt || Date.now()
      });

      updated++;
    } else {
      skipped++;
    }
  }

  await renderNotesList();
  await renderRecentList();

  const notesAfterImport = await getAllNotes();
  const currentNoteAfterImport = notesAfterImport.find(
    (note) => note.id === currentNoteId
  );

  if (currentNoteAfterImport) {
    currentNoteId = null;
    openNote(currentNoteAfterImport);
  }

  alert(
    'Импорт завершён.\n\n' +
    `Добавлено: ${added}\n` +
    `Обновлено: ${updated}\n` +
    `Без изменений: ${skipped}`
  );
}

// =========================
// 1.2) Ручная синхронизация с локальным Node.js-сервером
// =========================

// Адрес API на том же сервере, с которого открыто приложение.
// При запуске через Node.js это будет http://IP-ПК:3000/api/sync.
// Для GitHub Pages эта функция намеренно не используется:
// GitHub Pages не может подключиться к домашнему HTTP-серверу.
const SYNC_API_URL = './api/sync';

// Проверяем, что запись безопасно можно синхронизировать.
function isValidSyncNote(note) {
  return (
    note &&
    typeof note === 'object' &&
    typeof note.syncId === 'string' &&
    note.syncId.length > 0 &&
    typeof note.title === 'string' &&
    typeof note.body === 'string'
  );
}

// Берёт две версии набора заметок и объединяет их.
// Для совпадающего syncId побеждает версия с самым новым updatedAt.
function mergeNotesForSync(localNotes, serverNotes) {
  const bySyncId = new Map();

  for (const note of [...localNotes, ...serverNotes]) {
    if (!isValidSyncNote(note)) continue;

    const existing = bySyncId.get(note.syncId);

    if (!existing || Number(note.updatedAt || 0) > Number(existing.updatedAt || 0)) {
      bySyncId.set(note.syncId, note);
    }
  }

  return [...bySyncId.values()];
}

// Заменяет локальную копию заметок объединённым набором.
// Локальный IndexedDB id сохраняется для уже существующих заметок;
// новым заметкам IndexedDB выдаёт свой id автоматически.
async function applyMergedNotesToLocal(mergedNotes) {
  const localNotes = await getAllNotes();
  const localBySyncId = new Map(
    localNotes
      .filter((note) => note.syncId)
      .map((note) => [note.syncId, note])
  );

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const mergedNote of mergedNotes) {
    const localNote = localBySyncId.get(mergedNote.syncId);

    if (!localNote) {
      // Не переносим числовой id: он локален для конкретного браузера.
      const { id, ...noteWithoutId } = mergedNote;
      await saveNote(noteWithoutId);
      added++;
      continue;
    }

    const localUpdatedAt = Number(localNote.updatedAt || 0);
    const mergedUpdatedAt = Number(mergedNote.updatedAt || 0);

    if (mergedUpdatedAt > localUpdatedAt) {
      await saveNote({
        ...mergedNote,
        id: localNote.id,
        createdAt: localNote.createdAt || mergedNote.createdAt || Date.now()
      });
      updated++;
    } else {
      unchanged++;
    }
  }

  return { added, updated, unchanged };
}

// Выполняет полный ручной обмен с сервером.
async function syncWithServer() {
  const syncBtn = document.getElementById('syncBtn');

  try {
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.title = 'Синхронизация…';
    }

    // 1. Загружаем существующую общую копию.
    const getResponse = await fetch(SYNC_API_URL, {
      cache: 'no-store'
    });

    if (!getResponse.ok) {
      throw new Error(`Сервер вернул HTTP ${getResponse.status}`);
    }

    const serverData = await getResponse.json();

    if (!serverData || !Array.isArray(serverData.notes)) {
      throw new Error('Сервер вернул данные в неожиданном формате.');
    }

    // 2. Объединяем серверную и локальную копии.
    const localNotes = await getAllNotes();
    const mergedNotes = mergeNotesForSync(localNotes, serverData.notes);

    // 3. Записываем результат в текущий браузер.
    const localResult = await applyMergedNotesToLocal(mergedNotes);

    // 4. Отправляем объединённую копию обратно на сервер.
    const putResponse = await fetch(SYNC_API_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app: 'LogBook',
        syncVersion: 1,
        updatedAt: Date.now(),
        notes: mergedNotes
      })
    });

    if (!putResponse.ok) {
      throw new Error(`Не удалось сохранить данные: HTTP ${putResponse.status}`);
    }

    // 5. Обновляем интерфейс после получения новых заметок.
    await renderNotesList();
    await renderRecentList();

    // Если открытая заметка пришла с сервера в более новой версии,
    // заново открываем её, чтобы на экране был актуальный текст.
    if (currentNoteId) {
      const notesAfterSync = await getAllNotes();
      const currentNote = notesAfterSync.find((note) => note.id === currentNoteId);

      if (currentNote) {
        currentNoteId = null;
        openNote(currentNote);
      }
    }

    const serverResult = await putResponse.json();

    alert(
      'Синхронизация завершена.\n\n' +
      `На этом устройстве добавлено: ${localResult.added}\n` +
      `Обновлено: ${localResult.updated}\n` +
      `Без изменений: ${localResult.unchanged}\n` +
      `Всего на сервере: ${serverResult.notesCount}`
    );
  } catch (error) {
    console.error('Ошибка синхронизации:', error);

    alert(
      'Не удалось выполнить синхронизацию.\n\n' +
      'Проверьте, что Node.js-сервер запущен, ' +
      'устройство подключено к той же Wi‑Fi-сети, ' +
      'и LogBook открыт через адрес ПК вида http://IP-ПК:3000/.\n\n' +
      `Техническая причина: ${error.message}`
    );
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.title = 'Синхронизировать';
    }
  }
}

// =========================
// 2) Игровые механики (без изменений, как было)
// =========================

const GAME_KEY = 'notes-pwa-game';

function loadGameProfile() {
  const raw = localStorage.getItem(GAME_KEY);
  if (!raw) {
    return { score: 0, level: 1, lastDaily: 0 };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { score: 0, level: 1, lastDaily: 0 };
  }
}

function saveGameProfile(profile) {
  localStorage.setItem(GAME_KEY, JSON.stringify(profile));
}

function addScore(points) {
  const profile = loadGameProfile();
  profile.score += points;
  profile.level = 1 + Math.floor(profile.score / 100);
  saveGameProfile(profile);
  renderGamePanel();
}

function claimDailyBonus() {
  const profile = loadGameProfile();
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (now - profile.lastDaily < oneDayMs) {
    alert('Ежедневный бонус уже получен сегодня. Заходите завтра!');
    return;
  }

  addScore(20);
  profile.lastDaily = now;
  saveGameProfile(profile);
  renderGamePanel();
  alert('Ежедневный бонус получен: +20 очков!');
}

function renderGamePanel() {
  const profile = loadGameProfile();
  document.getElementById('scoreEl').textContent = profile.score;
  document.getElementById('levelEl').textContent = profile.level;
}

// =========================
// 3) UI: элементы, отрисовка списка, работа с редактором
// =========================

const titleInput = document.getElementById('titleInput');
const bodyInput = document.getElementById('bodyInput');
const previewContainerEl = document.getElementById('previewContainer');
const notesListEl = document.getElementById('notesList');
const searchInput = document.getElementById('searchInput');
const drawerEl = document.getElementById('drawer');

// Переменная для режима: true = редактирование, false = просмотр
let isEditMode = false;

let currentNoteId = null;

// Создать карточку заметки для списка (только заголовок)
function createNoteCardElement(note) {
  const card = document.createElement('div');
  card.className = 'noteCard';


  const h3 = document.createElement('h3');
  h3.textContent = note.title?.trim() || 'Без названия';
  h3.style.cursor = 'pointer';
  h3.onclick = () => openNote(note);
  card.appendChild(h3);


  const meta = document.createElement('div');
  meta.className = 'meta';
  const updated = new Date(note.updatedAt || Date.now()).toLocaleString();
  meta.textContent = `Обновлено: ${updated}`;
  card.appendChild(meta);


  return card;
}

// Отрисовать список всех заметок (с учётом поиска)
async function renderNotesList() {
  const notes = await getAllNotes();
  const query = searchInput.value.trim().toLowerCase();

  notesListEl.innerHTML = '';

  const filtered = notes.filter((n) => {
    if (!query) return true;
    const title = (n.title || '').toLowerCase();
    const body = (n.body || '').toLowerCase();
    return title.includes(query) || body.includes(query);
  });

  for (const note of filtered) {
    const card = createNoteCardElement(note);
    notesListEl.appendChild(card);
  }
}

// Открыть заметку в редакторе
function openNote(note) {
  // Сохраняем текущую заметку в историю
  if (currentNoteId) {
    backHistory.push(currentNoteId);
    if (backHistory.length > MAX_HISTORY) {
      backHistory.shift();
    }
    forwardHistory = []; // Очищаем forward при новом переходе
  }
  
  currentNoteId = note.id;
  titleInput.value = note.title || '';
  bodyInput.value = note.body || '';
  
  isEditMode = false;
  bodyInput.style.display = 'none';
  previewContainerEl.style.display = 'block';
  document.getElementById('editToggleBtn').title = 'Редактировать';
  
  renderPreview();
  updateNavButtons();
  renderRecentList();
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Обновить состояние кнопок Назад/Вперёд
function updateNavButtons() {
  const backBtn = document.getElementById('backBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  
  backBtn.disabled = backHistory.length === 0;
  forwardBtn.disabled = forwardHistory.length === 0;
}

// Обработчик кнопки Назад
async function handleBack() {
  if (backHistory.length === 0) return;
  
  // Сохраняем текущую в forward
  forwardHistory.push(currentNoteId);
  
  // Берём последнюю из back
  const prevId = backHistory.pop();
  const notes = await getAllNotes();
  const note = notes.find(n => n.id === prevId);
  
  if (note) {
    currentNoteId = note.id;
    titleInput.value = note.title || '';
    bodyInput.value = note.body || '';
    renderPreview();
    updateNavButtons();
  }
}

// Обработчик кнопки Вперёд
async function handleForward() {
  if (forwardHistory.length === 0) return;
  
  // Сохраняем текущую в back
  backHistory.push(currentNoteId);
  
  // Берём последнюю из forward
  const nextId = forwardHistory.pop();
  const notes = await getAllNotes();
  const note = notes.find(n => n.id === nextId);
  
  if (note) {
    currentNoteId = note.id;
    titleInput.value = note.title || '';
    bodyInput.value = note.body || '';
    renderPreview();
    updateNavButtons();
  }
}

// Отрисовать список «Недавние»
async function renderRecentList() {
  const recentListEl = document.getElementById('recentList');
  recentListEl.innerHTML = '';
  
  // Показываем последние 10 в обратном порядке
  const recentIds = [...backHistory].reverse();
  
  for (const id of recentIds) {
    const notes = await getAllNotes();
    const note = notes.find(n => n.id === id);
    if (!note) continue;
    
    const item = document.createElement('div');
    item.className = 'recentItem';
    
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = note.title?.trim() || 'Без названия';
    
    const timeEl = document.createElement('div');
    timeEl.className = 'time';
    timeEl.textContent = new Date(note.updatedAt || Date.now()).toLocaleString();
    
    item.appendChild(titleEl);
    item.appendChild(timeEl);
    
    item.onclick = () => {
      openNote(note);
    };
    
    recentListEl.appendChild(item);
  }
}

async function saveCurrentNote() {
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  if (!title && !body) {
    alert('Заметка пустая. Введите хотя бы заголовок или текст.');
    return;
  }

  const now = Date.now();
  let note;

  if (currentNoteId) {
    const notes = await getAllNotes();
    const existingNote = notes.find((item) => item.id === currentNoteId);

    note = {
      ...existingNote,
      id: currentNoteId,
      title,
      body,
      createdAt: existingNote?.createdAt || now,
      updatedAt: now
    };
  } else {
    note = {
      title,
      body,
      createdAt: now,
      updatedAt: now
    };
  }

  const savedNote = await saveNote(note);
  currentNoteId = savedNote.id;

  await renderNotesList();
  addScore(10);
  alert('Заметка сохранена!');
}

async function autoSaveCurrentNote() {
  if (!currentNoteId) return;

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();

  if (!title && !body) return;

  const notes = await getAllNotes();
  const existingNote = notes.find((item) => item.id === currentNoteId);

  if (!existingNote) return;

  const savedNote = await saveNote({
    ...existingNote,
    title,
    body,
    createdAt: existingNote.createdAt,
    updatedAt: Date.now()
  });

  currentNoteId = savedNote.id;
}

// Удалить текущую заметку
async function deleteCurrentNote() {
  if (!currentNoteId) {
    alert('Сначала откройте заметку, которую хотите удалить.');
    return;
  }
  if (!confirm('Удалить текущую заметку?')) return;

  await deleteNoteById(currentNoteId);
  await renderNotesList();
  newNote(); // очищаем поля
  addScore(5);
}

function normalizeTaskMarkers(markdown) {
  return markdown.replace(
    /^(\s*(?:[-*+]|\d+\.)\s+)\[([>\/!-])\](.*)$/gm,
    '$1[ ]$3'
  );
}

// Превращает внутренние ссылки LogBook:
// [[Название заметки]]
// [[Название заметки|Текст ссылки]]
//
// в обычные Markdown-ссылки с техническим адресом internal:.
// markdown-it безопасно отрисует их как <a>.
function convertInternalLinksToMarkdown(markdown) {
  return markdown.replace(
    /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g,
    (match, rawTitle, rawAlias) => {
      const title = rawTitle.trim();
      const text = (rawAlias || rawTitle).trim();

      // encodeURIComponent нужен, чтобы пробелы, кириллица и символы
      // в названии заметки не ломали адрес ссылки.
      const href = `internal:${encodeURIComponent(title)}`;

      return `[${text}](${href})`;
    }
  );
}

function renderPreview() {
  const markdownText = normalizeTaskMarkers(bodyInput.value);

  // Сначала превращаем [[Название]] в безопасную Markdown-ссылку.
  // Это делаем ДО markdown-it, пока исходный текст ещё не превращён в HTML.
  const markdownWithInternalLinks = convertInternalLinksToMarkdown(markdownText);

  // Затем markdown-it превращает весь текст в HTML.
  const html = md.render(markdownWithInternalLinks);

  previewContainerEl.innerHTML = html;

  decorateTaskCheckboxes();
  attachInternalLinkHandlers();
  processFoldableHeadings();
}

const TASK_STATES = [
  { key: 'backlog', marker: '>' },
  { key: 'todo', marker: ' ' },
  { key: 'doing', marker: '/' },
  { key: 'review', marker: '!' },
  { key: 'done', marker: 'x' },
  { key: 'cancelled', marker: '-' }
];

function getTaskState(marker) {
  const normalized = marker.toLowerCase();

  if (normalized === '>') return 'backlog';
  if (normalized === '/') return 'doing';
  if (normalized === '!') return 'review';
  if (normalized === 'x') return 'done';
  if (normalized === '-') return 'cancelled';

  return 'todo';
}

function getNextTaskState(state) {
  const index = TASK_STATES.findIndex((item) => item.key === state);
  return TASK_STATES[(index + 1) % TASK_STATES.length];
}

function replaceTaskStateInBody(taskIndex, nextMarker) {
  const lines = bodyInput.value.split('\n');
  let currentTaskIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const match = lines[lineIndex].match(/^(\s*(?:[-*+]|\d+\.)\s+)\[([^\]])\](\s+.*)?$/);

    if (!match) continue;

    if (currentTaskIndex === taskIndex) {
      const suffix = match[3] || '';
      lines[lineIndex] = `${match[1]}[${nextMarker}]${suffix}`;
      bodyInput.value = lines.join('\n');
      return true;
    }

    currentTaskIndex++;
  }

  return false;
}

function decorateTaskCheckboxes() {
  const checkboxes = previewContainerEl.querySelectorAll(
    'input[type="checkbox"]'
  );

  checkboxes.forEach((checkbox, taskIndex) => {
    const sourceLines = bodyInput.value.split('\n');
    let currentTaskIndex = 0;
    let marker = ' ';

    for (const line of sourceLines) {
      const match = line.match(/^\s*(?:[-*+]|\d+\.)\s+\[([^\]])\]/);

      if (!match) continue;

      if (currentTaskIndex === taskIndex) {
        marker = match[1];
        break;
      }

      currentTaskIndex++;
    }

    const state = getTaskState(marker);
    checkbox.className = 'task-checkbox';
    checkbox.dataset.state = state;
    checkbox.checked = state === 'done';

    if (state === 'done' || state === 'cancelled') {
      const label = checkbox.closest('li');
      if (label) label.classList.add(`task-text-${state}`);
    }

    checkbox.addEventListener('click', async (event) => {
      event.preventDefault();

      const currentState = checkbox.dataset.state;
      const nextState = getNextTaskState(currentState);

      if (!replaceTaskStateInBody(taskIndex, nextState.marker)) return;

      checkbox.dataset.state = nextState.key;
      checkbox.checked = nextState.key === 'done';

      renderPreview();
      await autoSaveCurrentNote();
    });
  });
}

function attachInternalLinkHandlers() {
  const links = previewContainerEl.querySelectorAll('a');

  for (const link of links) {
    const href = link.getAttribute('href') || '';

    // Обычные интернет-ссылки не трогаем.
    if (!href.startsWith('internal:')) continue;

    link.classList.add('internal-link');

    link.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      // Убираем "internal:" и возвращаем исходное название заметки.
      const encodedTitle = href.slice('internal:'.length);
      const noteTitle = decodeURIComponent(encodedTitle);

      await handleInternalLinkClick(noteTitle);
    });
  }
}

// Обработать заголовки: добавить многоточие и сворачивание
function processFoldableHeadings() {
  const headings = previewContainerEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  for (const heading of headings) {
    heading.classList.add('foldable-heading');
    
    let isCollapsed = false;
    
    heading.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      heading.classList.toggle('collapsed', isCollapsed);
      
      let next = heading.nextElementSibling;
      const headingLevel = parseInt(heading.tagName.charAt(1), 10);
      
      while (next) {
        if (next.tagName && /^H[1-6]$/.test(next.tagName)) {
          const nextLevel = parseInt(next.tagName.charAt(1), 10);
          if (nextLevel <= headingLevel) break;
        }
        next.style.display = isCollapsed ? 'none' : '';
        next = next.nextElementSibling;
      }
    });
  }
}

// Обработчик клика по внутренней ссылке
async function handleInternalLinkClick(noteTitle) {
  console.log('Клик по ссылке на:', noteTitle);
  // Пытаемся найти заметку по заголовку
  const note = await findNoteByTitle(noteTitle);

  if (note) {
    // Если заметка есть — открываем её
    openNote(note);
  } else {
    // Если заметки нет — спрашиваем, создать ли
    const ok = confirm(`Создать заметку "${noteTitle}"?`);
    if (ok) {
      const now = Date.now();
      const newNote = {
        title: noteTitle,
        body: '',
        createdAt: now,
        updatedAt: now
      };
      const savedNote = await saveNote(newNote);
      openNote(savedNote);
      await renderNotesList();
      addScore(10);
    }
  }
}

// Переключить режим: просмотр ↔ редактирование
async function toggleEditMode() {
  isEditMode = !isEditMode;


  const editToggleBtn = document.getElementById('editToggleBtn');


  if (isEditMode) {
    // Режим редактирования: показываем textarea, скрываем превью
    bodyInput.style.display = 'block';
    previewContainerEl.style.display = 'none';
    editToggleBtn.title = 'Просмотр';
    bodyInput.focus();
  } else {
    // Режим просмотра: скрываем textarea, показываем превью
    bodyInput.style.display = 'none';
    previewContainerEl.style.display = 'block';
    editToggleBtn.title = 'Редактировать';
    
    // Сохраняем заметку перед переключением
    await autoSaveCurrentNote();
    
    renderPreview(); // обновляем превью
  }
}

// Очистить поля редактора (для новой заметки)
function newNote() {
  currentNoteId = null;
  titleInput.value = '';
  bodyInput.value = '';
  titleInput.focus();
}

// =========================
// 4) Автооткрытие/автосоздание заметки на сегодня
// =========================


async function openOrCreateTodayDaily() {
  // Генерируем заголовок для сегодняшней ежедневной заметки
  const todayTitle = getTodayDailyTitle();


  // Пытаемся найти заметку с таким заголовком
  let note = await findNoteByTitle(todayTitle);


  if (note) {
    // Если заметка уже есть — просто открываем её
    openNote(note);
  } else {
    // Если заметки нет — создаём новую
    const now = Date.now();
    note = {
      title: todayTitle,
      body: '', // пустое содержимое
      createdAt: now,
      updatedAt: now
    };


    // Сохраняем в базу и получаем id
    /* const id = await saveNote(note);
    note.id = id; // Присваиваем id заметке */

    note = await saveNote(note);

    // Открываем в редакторе
    openNote(note);
  }
}

// =========================
// 5) Инициализация приложения
// =========================

async function initApp() {
  await openDB();
  await migrateExistingNotesForSync();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('SW registered:', reg.scope))
        .catch((err) => console.error('SW error:', err));
    });
  }

  await openOrCreateTodayDaily();
  await renderNotesList();
  renderGamePanel();

  // Инициализация селекторов календаря
  initCalendarSelectors();

  // Кнопка переключения режимов: Редактировать / Просмотр
  const editToggleBtn = document.getElementById('editToggleBtn');
  editToggleBtn.onclick = () => {
  toggleEditMode();
  };

  // Кнопка «Меню»
  const menuBtn = document.getElementById('menuBtn');
  menuBtn.onclick = () => {
  drawerEl.classList.toggle('open');
  const isOpen = drawerEl.classList.contains('open');
  // Меняем подсказку (tooltip), а не текст кнопки
  menuBtn.title = isOpen ? 'Закрыть' : 'Меню';
  };

  // Кнопка «Календарь» — теперь открывает панель календаря
  const calendarBtn = document.getElementById('calendarBtn');
  calendarBtn.onclick = () => {
    openCalendarPanel();
  };

  // Кнопка «Закрыть» в календаре
  closeCalendarBtnEl.onclick = () => {
    closeCalendarPanel();
  };

  // Остальные обработчики
  document.getElementById('deleteNoteBtn').onclick = deleteCurrentNote;
  document.getElementById('claimDailyBtn').onclick = claimDailyBonus;

  // Кнопки Назад/Вперёд
  document.getElementById('backBtn').onclick = handleBack;
  document.getElementById('forwardBtn').onclick = handleForward;

  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');
  const syncBtn = document.getElementById('syncBtn');

  exportBtn.onclick = exportBackup;
  syncBtn.onclick = syncWithServer;

  importBtn.onclick = () => {
    importFileInput.value = '';
    importFileInput.click();
  };

  importFileInput.onchange = async () => {
    const file = importFileInput.files[0];
    await importBackupFromFile(file);
  };

  searchInput.addEventListener('input', renderNotesList);
}

// =========================
// 6) Календарь: переменные и функции
// =========================

// Элементы календаря
const calendarPanelEl = document.getElementById('calendarPanel');
const calendarMonthSelectEl = document.getElementById('calendarMonthSelect');
const calendarYearSelectEl = document.getElementById('calendarYearSelect');
const calendarWeekdaysGridEl = document.getElementById('calendarWeekdaysGrid');
const calendarDaysGridEl = document.getElementById('calendarDaysGrid');
const closeCalendarBtnEl = document.getElementById('closeCalendarBtn');

// Текущий выбранный месяц и год в календаре (month: 0–11, year: полный год)
let calendarCurrentMonth = getTodayDateParts().month;
let calendarCurrentYear = getTodayDateParts().year;

// Инициализация селекторов месяца и года
function initCalendarSelectors() {
  // Заполняем селект месяцев (январь–декабрь)
  calendarMonthSelectEl.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = MONTH_SELECT_NAMES[i];
    calendarMonthSelectEl.appendChild(opt);
  }

  // Заполняем селект годов: текущий год ±10 лет
  const nowYear = getTodayDateParts().year;
  const minYear = nowYear - 10;
  const maxYear = nowYear + 10;

  calendarYearSelectEl.innerHTML = '';
  for (let y = minYear; y <= maxYear; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    calendarYearSelectEl.appendChild(opt);
  }

  // Устанавливаем текущие значения
  calendarMonthSelectEl.value = String(calendarCurrentMonth);
  calendarYearSelectEl.value = String(calendarCurrentYear);

  // Обработчики: при смене месяца/года перерисовываем календарь
  calendarMonthSelectEl.addEventListener('change', () => {
    calendarCurrentMonth = parseInt(calendarMonthSelectEl.value, 10);
    renderCalendar();
  });

  calendarYearSelectEl.addEventListener('change', () => {
    calendarCurrentYear = parseInt(calendarYearSelectEl.value, 10);
    renderCalendar();
  });
}

// Отрисовка шапки календаря (Пн–Вс)
function renderCalendarWeekdaysHeader() {
  calendarWeekdaysGridEl.innerHTML = '';
  for (const name of WEEKDAY_HEADER_NAMES) {
    const cell = document.createElement('div');
    cell.className = 'calendarWeekday';
    cell.textContent = name;
    calendarWeekdaysGridEl.appendChild(cell);
  }
}

// Отрисовка сетки дней месяца
async function renderCalendarDaysGrid() {
  calendarDaysGridEl.innerHTML = '';

  const month = calendarCurrentMonth;
  const year = calendarCurrentYear;

  const daysInMonth = getDaysInMonth(month, year);
  const firstDayJsWeekday = getFirstDayWeekday(month, year); // 0=Вс, 1=Пн, ..., 6=Сб
  const firstDayMonFirst = jsWeekdayToMonFirst(firstDayJsWeekday); // 0=Пн, ..., 6=Вс

  // Получаем множество дат ежедневных заметок в формате "YYYY-MM-DD"
  const dailyDatesSet = await getDailyNotesDatesSet();

  // Сегодняшняя дата для подсветки
  const todayParts = getTodayDateParts();
  const isCurrentMonthToday = todayParts.month === month && todayParts.year === year;

  // Пустые ячейки до 1-го числа (с понедельника)
  for (let i = 0; i < firstDayMonFirst; i++) {
    const emptyCell = document.createElement('div');
    calendarDaysGridEl.appendChild(emptyCell);
  }

  // Дни месяца
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendarCell';

    // Формируем ключ даты "YYYY-MM-DD"
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Проверяем, есть ли заметка на этот день
    const hasNote = dailyDatesSet.has(dateKey);
    if (hasNote) {
      cell.classList.add('hasNote');
    }

    // Подсветка сегодняшнего дня
    if (isCurrentMonthToday && day === todayParts.day) {
      cell.classList.add('today');
    }

    // Текст ячейки — просто число дня
    cell.textContent = String(day);

    // Обработчик клика
    cell.onclick = () => handleCalendarDayClick(day, month, year);

    calendarDaysGridEl.appendChild(cell);
  }
}

// Обработчик клика по дню в календаре
async function handleCalendarDayClick(day, month, year) {
  const title = formatDailyTitleFromParts(day, month, year);
  const note = await findNoteByTitle(title);

  if (note) {
    // Если заметка есть — открываем её
    openNote(note);
    // Закрываем календарь для удобства
    closeCalendarPanel();
  } else {
    // Если заметки нет — спрашиваем, создать ли
    const ok = confirm(`Создать заметку на ${title}?`);
    if (ok) {
      const now = Date.now();
      const newNote = {
        title: title,
        body: '',
        createdAt: now,
        updatedAt: now
      };
      const savedNote = await saveNote(newNote);
      openNote(savedNote);
      closeCalendarPanel();
      // Перерисовываем список заметок и календарь, чтобы увидеть новую заметку
      await renderNotesList();
      await renderCalendarDaysGrid();
      addScore(10);
    }
  }
}

// Полная перерисовка календаря
async function renderCalendar() {
  renderCalendarWeekdaysHeader();
  await renderCalendarDaysGrid();
}

// Открыть панель календаря
async function openCalendarPanel() {
  // Устанавливаем текущий месяц/год при открытии
  const today = getTodayDateParts();
  calendarCurrentMonth = today.month;
  calendarCurrentYear = today.year;
  calendarMonthSelectEl.value = String(calendarCurrentMonth);
  calendarYearSelectEl.value = String(calendarCurrentYear);

  calendarPanelEl.classList.add('open');
  await renderCalendar();
}

// Закрыть панель календаря
function closeCalendarPanel() {
  calendarPanelEl.classList.remove('open');
}

// Запуск приложения
initApp().catch((err) => {
  console.error('Ошибка инициализации приложения:', err);
  alert('Не удалось инициализировать приложение. Проверьте консоль разработчика.');
});