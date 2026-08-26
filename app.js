// =========================
// 0) Вспомогательные функции для дат и форматов
// =========================

const MONTH_NAMES = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const WEEKDAY_NAMES = [
  'воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'
];

const MAX_HISTORY = 10;
let backHistory = [];
let forwardHistory = [];
let appLocked = false;

const MONTH_SELECT_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

const WEEKDAY_HEADER_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function getDaysInMonth(month, year) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayWeekday(month, year) {
  return new Date(year, month, 1).getDay();
}

function jsWeekdayToMonFirst(jsWeekday) {
  return (jsWeekday + 6) % 7;
}

function formatDailyTitleFromParts(day, month, year) {
  const date = new Date(year, month, day);
  const weekday = date.getDay();
  return formatDailyTitle(day, month, year, weekday);
}

function isDailyNoteTitle(title) {
  if (!title) return false;
  const parts = title.split(' ');
  if (parts.length < 4) return false;
  const lastPart = parts[parts.length - 1].toLowerCase();
  return WEEKDAY_NAMES.includes(lastPart);
}

function parseDailyNoteTitle(title) {
  if (!isDailyNoteTitle(title)) return null;
  const parts = title.split(' ');
  if (parts.length < 4) return null;
  const dayStr = parts[0];
  const monthName = parts[1].toLowerCase();
  const yearStr = parts[2];
  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  const monthIndex = MONTH_NAMES.findIndex((m) => m === monthName);
  if (monthIndex === -1) return null;
  return { day, month: monthIndex, year };
}

async function getDailyNotesDatesSet() {
  const notes = await getAllNotes();
  const set = new Set();
  for (const note of notes) {
    const parsed = parseDailyNoteTitle(note.title);
    if (!parsed) continue;
    const { day, month, year } = parsed;
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    set.add(key);
  }
  return set;
}

function formatDailyTitle(day, month, year, weekday) {
  const dayStr = day < 10 ? '0' + day : String(day);
  const monthName = MONTH_NAMES[month];
  const weekdayName = WEEKDAY_NAMES[weekday];
  return `${dayStr} ${monthName} ${year} ${weekdayName}`;
}

function getTodayDateParts() {
  const now = new Date();
  return {
    day: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
    weekday: now.getDay()
  };
}

function getTodayDailyTitle() {
  const { day, month, year, weekday } = getTodayDateParts();
  return formatDailyTitle(day, month, year, weekday);
}

// =========================
// 0.2) Инициализация markdown-it
// =========================

const md = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
})
    .use(window.markdownitCheckbox)
    .use(window.markdownitFootnote);

// =========================
// 1) IndexedDB: открытие базы и CRUD операции
// =========================

const DB_NAME = 'notes-pwa-db';
const DB_VERSION = 2;
const STORE_NAME = 'notes';
const SETTINGS_STORE_NAME = 'settings';

// =========================
// 1.0) Шифрование
// =========================

const CRYPTO_SETTINGS_KEY = 'encryption-config';
const CRYPTO_VERSION = 1;
const PBKDF2_ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

let encryptionEnabled = false;
let masterKey = null;
let encryptionConfig = null;

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveMasterKey(password, saltBytes) {
  const passwordBytes = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      'PBKDF2',
      false,
      ['deriveKey']
  );
  return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations: PBKDF2_ITERATIONS
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
  );
}

async function encryptJson(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptJson(encryptedValue, key) {
  const iv = base64ToBytes(encryptedValue.iv);
  const ciphertext = base64ToBytes(encryptedValue.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function getSettingsStore(mode = 'readonly') {
  return db.transaction(SETTINGS_STORE_NAME, mode).objectStore(SETTINGS_STORE_NAME);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadEncryptionConfig() {
  const record = await requestToPromise(getSettingsStore().get(CRYPTO_SETTINGS_KEY));
  encryptionConfig = record?.value || null;
  encryptionEnabled = false;
  return encryptionConfig;
}

async function saveEncryptionConfig(config) {
  const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(SETTINGS_STORE_NAME);
  await requestToPromise(store.put({ key: CRYPTO_SETTINGS_KEY, value: config }));
  encryptionConfig = config;
  encryptionEnabled = true;
}

async function createEncryptionConfig(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Пароль должен содержать не менее 12 символов.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveMasterKey(password, salt);
  const verifier = await encryptJson({ purpose: 'logbook-password-verifier', version: CRYPTO_VERSION }, key);
  const config = {
    version: CRYPTO_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', keyLength: 256 },
    verifier,
    createdAt: Date.now()
  };
  await saveEncryptionConfig(config);
  masterKey = key;
  return config;
}

async function unlockEncryption(password) {
  const config = await loadEncryptionConfig();
  if (!config) throw new Error('Шифрование ещё не настроено.');
  const salt = base64ToBytes(config.kdf.salt);
  const key = await deriveMasterKey(password, salt);
  const verifier = await decryptJson(config.verifier, key);
  if (verifier?.purpose !== 'logbook-password-verifier' || verifier?.version !== CRYPTO_VERSION) {
    throw new Error('Проверочный блок имеет неверный формат.');
  }
  masterKey = key;
  encryptionEnabled = true;
  return true;
}

let db = null;

function createSyncId() {
  return crypto.randomUUID();
}

function normalizeTag(tag) {
  return String(tag || '').trim().replace(/^#+/, '').replace(/\s+/g, ' ').normalize('NFC').toLowerCase();
}

function normalizeTags(tags) {
  let source = tags;
  if (typeof source === 'string') source = source.split(',');
  if (!Array.isArray(source)) return [];
  return [...new Set(source.map(normalizeTag).filter(Boolean))];
}

function normalizeNote(note) {
  const now = Date.now();
  return {
    ...note,
    tags: normalizeTags(note.tags),
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
      if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        database.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}

async function getAllNotes() {
  const rawNotes = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (!encryptionEnabled || !masterKey) {
    const hasEncryptedNotes = rawNotes.some((note) => note.encrypted === true);
    if (hasEncryptedNotes) {
      throw new Error('Заметки заблокированы: требуется пароль.');
    }
    return rawNotes;
  }

  const result = [];
  for (const note of rawNotes) {
    if (note.encrypted) {
      try {
        const payload = await decryptJson(note.data, masterKey);
        result.push({
          id: note.id,
          syncId: note.syncId,
          title: payload.title || '',
          body: payload.body || '',
          tags: payload.tags || [],
          createdAt: note.createdAt,
          updatedAt: note.updatedAt
        });
      } catch (err) {
        console.error('Не удалось расшифровать заметку:', note.id, err);
        result.push({
          id: note.id,
          syncId: note.syncId,
          title: '[Ошибка расшифровки]',
          body: '',
          tags: [],
          createdAt: note.createdAt,
          updatedAt: note.updatedAt
        });
      }
    } else {
      result.push(note);
    }
  }
  return result;
}

async function findNoteByTitle(title) {
  const notes = await getAllNotes();
  return notes.find((n) => n.title === title) || null;
}

async function saveNote(note) {
  const normalizedNote = normalizeNote(note);

  if (!normalizedNote.id && normalizedNote.title) {
    const existingNotes = await getAllNotes();
    const existing = existingNotes.find((n) => n.title === normalizedNote.title && n.id !== normalizedNote.id);
    if (existing) {
      return saveNote({
        ...normalizedNote,
        id: existing.id,
        createdAt: existing.createdAt || normalizedNote.createdAt,
        updatedAt: Date.now()
      });
    }
  }

  let record;

  if (encryptionEnabled && masterKey) {
    const payload = {
      title: normalizedNote.title || '',
      body: normalizedNote.body || '',
      tags: normalizedNote.tags || []
    };
    const encryptedData = await encryptJson(payload, masterKey);
    record = {
      syncId: normalizedNote.syncId,
      encrypted: true,
      data: encryptedData,
      createdAt: normalizedNote.createdAt,
      updatedAt: normalizedNote.updatedAt
    };
    if (normalizedNote.id != null) record.id = normalizedNote.id;
  } else {
    record = {
      syncId: normalizedNote.syncId,
      title: normalizedNote.title || '',
      body: normalizedNote.body || '',
      tags: normalizedNote.tags || [],
      createdAt: normalizedNote.createdAt,
      updatedAt: normalizedNote.updatedAt
    };
    if (normalizedNote.id != null) record.id = normalizedNote.id;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve({ ...record, id: request.result });
    request.onerror = () => reject(request.error);
  });
}

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
  if (migrated > 0) console.log(`Подготовлено для синхронизации заметок: ${migrated}`);
}

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
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const time = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('-');
  return `logbook-backup-${date}_${time}.json`;
}

async function exportBackup() {
  const notes = await getAllNotes();

  const backup = {
    app: 'LogBook',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes
  };

  if (encryptionEnabled && masterKey) {
    const encryptedBackup = await encryptJson(backup, masterKey);
    const backupEncrypted = {
      app: 'LogBook',
      version: 1,
      encrypted: true,
      exportedAt: backup.exportedAt,
      kdf: encryptionConfig?.kdf || {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: PBKDF2_ITERATIONS,
        salt: encryptionConfig.kdf.salt
      },
      data: encryptedBackup
    };

    const json = JSON.stringify(backupEncrypted, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = createBackupFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    alert(`Зашифрованная резервная копия создана.\n\nЗаметок: ${notes.length}`);
  } else {
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
}

function isValidBackup(backup) {
  if (!backup || typeof backup !== 'object') return false;
  if (backup.app !== 'LogBook') return false;

  if (!backup.encrypted && !Array.isArray(backup.notes)) return false;
  if (backup.encrypted && (!backup.data || typeof backup.data !== 'object')) return false;

  return true;
}

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

  if (backup.encrypted && backup.data) {
    let decrypted = null;

    if (encryptionEnabled && masterKey) {
      try {
        decrypted = await decryptJson(backup.data, masterKey);
      } catch (err) {
        console.warn('Текущий ключ не подошёл к backup:', err);
      }
    }

    if (!decrypted && backup.kdf?.salt) {
      const password = prompt('Этот backup зашифрован. Введите пароль, которым он был создан:');
      if (!password) return;

      try {
        const salt = base64ToBytes(backup.kdf.salt);
        const backupKey = await deriveMasterKey(password, salt);
        decrypted = await decryptJson(backup.data, backupKey);
      } catch (err) {
        console.error('Ошибка расшифровки backup:', err);
        alert('Не удалось расшифровать backup. Неверный пароль или повреждённый файл.');
        return;
      }
    }

    if (!decrypted) {
      alert('Не удалось расшифровать backup.\n\nЕсли это старый файл без поля kdf, он открывается только тем же ключом, которым был создан.');
      return;
    }

    backup = decrypted;
  }

  const incomingNotes = backup.notes.filter((note) => {
    return note && typeof note === 'object' && typeof note.title === 'string' && typeof note.body === 'string';
  });

  if (incomingNotes.length === 0) {
    alert('В резервной копии нет заметок для импорта.');
    return;
  }

  const confirmed = confirm(`Импортировать ${incomingNotes.length} заметок?\n\nСуществующие заметки с теми же заголовками будут перезаписаны данными из backup.`);
  if (!confirmed) return;

  const existingNotes = await getAllNotes();
  const existingByTitle = new Map();
  for (const note of existingNotes) {
    const key = note.title;
    if (!existingByTitle.has(key)) {
      existingByTitle.set(key, []);
    }
    existingByTitle.get(key).push(note);
  }

  let added = 0;
  let updated = 0;

  const incomingByTitle = new Map();
  for (const note of incomingNotes) {
    const key = note.title;
    if (!incomingByTitle.has(key)) {
      incomingByTitle.set(key, []);
    }
    incomingByTitle.get(key).push(note);
  }

  const incomingDeduped = [];
  for (const [key, notes] of incomingByTitle.entries()) {
    const nonEmpty = notes.find((n) => (n.body || '').trim() !== '');
    incomingDeduped.push(nonEmpty || notes[0]);
  }

  for (const incomingNote of incomingDeduped) {
    const titleKey = incomingNote.title;
    const locals = existingByTitle.get(titleKey) || [];

    if (locals.length === 0) {
      const { id, ...noteWithoutId } = incomingNote;
      await saveNote({
        ...noteWithoutId,
        createdAt: noteWithoutId.createdAt || Date.now(),
        updatedAt: noteWithoutId.updatedAt || Date.now()
      });
      added++;
    } else {
      const [first, ...rest] = locals;
      await saveNote({
        ...incomingNote,
        id: first.id,
        createdAt: first.createdAt || incomingNote.createdAt || Date.now(),
        updatedAt: incomingNote.updatedAt || Date.now()
      });
      for (const dup of rest) {
        await deleteNoteById(dup.id);
      }
      updated++;
    }
  }

  await renderNotesList();
  await renderRecentList();

  if (currentNoteId) {
    const notesAfterImport = await getAllNotes();
    const currentNote = notesAfterImport.find((note) => note.id === currentNoteId);
    if (currentNote) openNote(currentNote);
  }

  alert(`Импорт завершён.\n\nДобавлено: ${added}\nОбновлено: ${updated}`);
}

// =========================
// 1.2) Ручная синхронизация с локальным Node.js-сервером
// =========================

const SYNC_API_URL = './api/sync';

function isValidSyncNote(note) {
  return note && typeof note === 'object' && typeof note.syncId === 'string' && note.syncId.length > 0 && typeof note.title === 'string' && typeof note.body === 'string';
}

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

async function applyMergedNotesToLocal(mergedNotes) {
  const localNotes = await getAllNotes();
  const localBySyncId = new Map(localNotes.filter((note) => note.syncId).map((note) => [note.syncId, note]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const mergedNote of mergedNotes) {
    const localNote = localBySyncId.get(mergedNote.syncId);
    if (!localNote) {
      const { id, ...noteWithoutId } = mergedNote;
      await saveNote(noteWithoutId);
      added++;
      continue;
    }
    const localUpdatedAt = Number(localNote.updatedAt || 0);
    const mergedUpdatedAt = Number(mergedNote.updatedAt || 0);
    if (mergedUpdatedAt > localUpdatedAt) {
      await saveNote({ ...mergedNote, id: localNote.id, createdAt: localNote.createdAt || mergedNote.createdAt || Date.now() });
      updated++;
    } else {
      unchanged++;
    }
  }
  return { added, updated, unchanged };
}

async function syncWithServer() {
  const syncBtn = document.getElementById('syncBtn');
  try {
    if (syncBtn) { syncBtn.disabled = true; syncBtn.title = 'Синхронизация…'; }
    const getResponse = await fetch(SYNC_API_URL, { cache: 'no-store' });
    if (!getResponse.ok) throw new Error(`Сервер вернул HTTP ${getResponse.status}`);
    const serverData = await getResponse.json();
    if (!serverData || !Array.isArray(serverData.notes)) throw new Error('Сервер вернул данные в неожиданном формате.');
    const localNotes = await getAllNotes();
    const mergedNotes = mergeNotesForSync(localNotes, serverData.notes);
    const localResult = await applyMergedNotesToLocal(mergedNotes);
    const putResponse = await fetch(SYNC_API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'LogBook', syncVersion: 1, updatedAt: Date.now(), notes: mergedNotes })
    });
    if (!putResponse.ok) throw new Error(`Не удалось сохранить данные: HTTP ${putResponse.status}`);
    await renderNotesList();
    await renderRecentList();
    if (currentNoteId) {
      const notesAfterSync = await getAllNotes();
      const currentNote = notesAfterSync.find((note) => note.id === currentNoteId);
      if (currentNote) { currentNoteId = null; openNote(currentNote); }
    }
    const serverResult = await putResponse.json();
    alert(`Синхронизация завершена.\n\nНа этом устройстве добавлено: ${localResult.added}\nОбновлено: ${localResult.updated}\nБез изменений: ${localResult.unchanged}\nВсего на сервере: ${serverResult.notesCount}`);
  } catch (error) {
    console.error('Ошибка синхронизации:', error);
    alert(`Не удалось выполнить синхронизацию.\n\nПроверьте, что Node.js-сервер запущен, устройство подключено к той же Wi‑Fi-сети, и LogBook открыт через адрес ПК вида http://IP-ПК:3000/.\n\nТехническая причина: ${error.message}`);
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.title = 'Синхронизировать'; }
  }
}

// =========================
// 2) Игровые механики
// =========================

const GAME_KEY = 'notes-pwa-game';

function loadGameProfile() {
  const raw = localStorage.getItem(GAME_KEY);
  if (!raw) return { score: 0, level: 1, lastDaily: 0 };
  try { return JSON.parse(raw); } catch { return { score: 0, level: 1, lastDaily: 0 }; }
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
  const scoreEl = document.getElementById('scoreEl');
  const levelEl = document.getElementById('levelEl');
  if (!scoreEl || !levelEl) return;
  const profile = loadGameProfile();
  scoreEl.textContent = profile.score;
  levelEl.textContent = profile.level;
}

// =========================
// 3) UI: элементы, отрисовка списка, работа с редактором
// =========================

const titleInput = document.getElementById('titleInput');
const bodyInput = document.getElementById('bodyInput');
const tagsEditorEl = document.getElementById('tagsEditor');
const tagsInput = document.getElementById('tagsInput');
const noteTagsViewEl = document.getElementById('noteTagsView');
const previewContainerEl = document.getElementById('previewContainer');
const notesListEl = document.getElementById('notesList');
const searchInput = document.getElementById('searchInput');
const drawerEl = document.getElementById('drawer');

let isEditMode = false;
let currentNoteId = null;

function createNoteCardElement(note) {
  const card = document.createElement('div');
  card.className = 'noteCard';
  const h3 = document.createElement('h3');
  h3.textContent = note.title?.trim() || 'Без названия';
  h3.style.cursor = 'pointer';
  h3.onclick = () => openNoteFromMenu(note);
  card.appendChild(h3);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const updated = new Date(note.updatedAt || Date.now()).toLocaleString();
  meta.textContent = `Обновлено: ${updated}`;
  card.appendChild(meta);
  return card;
}

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
  renderTagsList();
}

function getAllTagsWithCounts(notes) {
  const counts = new Map();
  for (const note of notes) {
    for (const tag of normalizeTags(note.tags)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([tag, count]) => ({ tag, count }));
}

async function renderTagsList() {
  const tagsListEl = document.getElementById('tagsList');
  if (!tagsListEl) return;
  const notes = await getAllNotes();
  const tags = getAllTagsWithCounts(notes);
  tagsListEl.innerHTML = '';
  if (tags.length === 0) {
    tagsListEl.textContent = 'Тегов пока нет.';
    return;
  }
  for (const { tag, count } of tags) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tagLink';
    const nameEl = document.createElement('span');
    nameEl.textContent = `#${tag}`;
    const countEl = document.createElement('span');
    countEl.className = 'tagCount';
    countEl.textContent = `(${count})`;
    button.append(nameEl, countEl);
    button.addEventListener('click', () => openTagPages(tag));
    tagsListEl.appendChild(button);
  }
}

function openMenuToTags() {
  const menuOverlayEl = document.getElementById('menuOverlay');
  const calendarOverlayEl = document.getElementById('calendarOverlay');
  const drawer = document.getElementById('drawer');
  const tagsBtn = document.getElementById('tagsSectionBtn');
  const tagsSection = tagsBtn?.closest('.menuSection');

  if (calendarOverlayEl) {
    calendarOverlayEl.classList.remove('open');
    calendarOverlayEl.setAttribute('aria-hidden', 'true');
  }

  if (drawer) drawer.classList.add('open');

  if (menuOverlayEl) {
    menuOverlayEl.classList.add('open');
    menuOverlayEl.setAttribute('aria-hidden', 'false');
  }

  if (tagsSection) tagsSection.classList.remove('collapsed');
  if (tagsBtn) tagsBtn.setAttribute('aria-expanded', 'true');
}

async function openTagPages(tag) {
  openMenuToTags();

  const normalizedTag = normalizeTag(tag);
  const notes = await getAllNotes();
  const matchingNotes = notes
      .filter((note) => normalizeTags(note.tags).includes(normalizedTag))
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ru'));

  const tagPagesViewEl = document.getElementById('tagPagesView');
  const tagsListEl = document.getElementById('tagsList');
  const selectedTagTitleEl = document.getElementById('selectedTagTitle');
  const tagPagesListEl = document.getElementById('tagPagesList');

  tagsListEl.hidden = true;
  tagPagesViewEl.hidden = false;
  selectedTagTitleEl.textContent = `Страницы с тегом #${normalizedTag} (${matchingNotes.length})`;
  tagPagesListEl.innerHTML = '';

  for (const note of matchingNotes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tagPageLink';
    button.textContent = note.title?.trim() || 'Без названия';
    button.addEventListener('click', () => openNoteFromMenu(note));
    tagPagesListEl.appendChild(button);
  }
}

function closeTagPages() {
  const tagsListEl = document.getElementById('tagsList');
  const tagPagesViewEl = document.getElementById('tagPagesView');
  tagsListEl.hidden = false;
  tagPagesViewEl.hidden = true;
}

function setupMenuSections() {
  const sections = [
    ['viewedSectionBtn', 'viewedSectionBody'],
    ['pagesSectionBtn', 'pagesSectionBody'],
    ['tagsSectionBtn', 'tagsSectionBody']
  ];

  for (const [buttonId, bodyId] of sections) {
    const button = document.getElementById(buttonId);
    const body = document.getElementById(bodyId);
    if (!button || !body) continue;
    button.addEventListener('click', () => {
      const section = button.closest('.menuSection');
      const collapsed = section.classList.toggle('collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
    });
  }
  document.getElementById('allTagsBtn')?.addEventListener('click', closeTagPages);
}

function renderNoteTags(note) {
  noteTagsViewEl.innerHTML = '';
  const tags = normalizeTags(note?.tags);
  if (tags.length === 0) {
    noteTagsViewEl.classList.remove('visible');
    return;
  }
  for (const tag of tags) {
    const tagEl = document.createElement('button');
    tagEl.type = 'button';
    tagEl.className = 'noteTag';
    tagEl.textContent = `#${tag}`;
    tagEl.title = `Открыть страницы с тегом #${tag}`;
    tagEl.addEventListener('click', () => openTagPages(tag));
    noteTagsViewEl.appendChild(tagEl);
  }
  noteTagsViewEl.classList.add('visible');
}

function setTagsEditorVisible(isVisible) {
  tagsEditorEl.style.display = isVisible ? 'block' : 'none';
  noteTagsViewEl.style.display = isVisible ? 'none' : '';
}

function getTagsFromInput() {
  return normalizeTags(tagsInput.value);
}

function openNote(note) {
  if (currentNoteId === note.id) {
    titleInput.value = note.title || '';
    bodyInput.value = note.body || '';
    tagsInput.value = normalizeTags(note.tags).join(', ');
    renderNoteTags(note);
    isEditMode = false;
    setTagsEditorVisible(false);
    bodyInput.style.display = 'none';
    previewContainerEl.style.display = 'block';
    document.getElementById('editToggleBtn').title = 'Редактировать';
    renderPreview();
    updateNavButtons();
    renderRecentList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (currentNoteId != null) {
    backHistory = backHistory.filter(id => id !== currentNoteId);
    backHistory.push(currentNoteId);
    if (backHistory.length > MAX_HISTORY) backHistory.shift();
    forwardHistory = [];
  }
  currentNoteId = note.id;
  titleInput.value = note.title || '';
  bodyInput.value = note.body || '';
  tagsInput.value = normalizeTags(note.tags).join(', ');
  renderNoteTags(note);
  isEditMode = false;
  setTagsEditorVisible(false);
  bodyInput.style.display = 'none';
  previewContainerEl.style.display = 'block';
  document.getElementById('editToggleBtn').title = 'Редактировать';
  renderPreview();
  updateNavButtons();
  renderRecentList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openNoteFromMenu(note) {
  openNote(note);
  const menuOverlayEl = document.getElementById('menuOverlay');
  if (menuOverlayEl) {
    menuOverlayEl.classList.remove('open');
    menuOverlayEl.setAttribute('aria-hidden', 'true');
    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) menuBtn.title = 'Меню';
  }
}

function updateNavButtons() {
  const backBtn = document.getElementById('backBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  backBtn.disabled = backHistory.length === 0;
  forwardBtn.disabled = forwardHistory.length === 0;
}

async function handleBack() {
  if (backHistory.length === 0) return;
  forwardHistory.push(currentNoteId);
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

async function handleForward() {
  if (forwardHistory.length === 0) return;
  backHistory.push(currentNoteId);
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

async function renderRecentList() {
  const recentListEl = document.getElementById('recentList');
  recentListEl.innerHTML = '';
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
    item.onclick = () => openNoteFromMenu(note);
    recentListEl.appendChild(item);
  }
}

async function saveCurrentNote() {
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  const tags = getTagsFromInput();
  if (!title && !body) {
    alert('Заметка пустая. Введите хотя бы заголовок или текст.');
    return;
  }
  const now = Date.now();
  let note;
  if (currentNoteId) {
    const notes = await getAllNotes();
    const existingNote = notes.find((item) => item.id === currentNoteId);
    note = { ...existingNote, id: currentNoteId, title, body, tags, createdAt: existingNote?.createdAt || now, updatedAt: now };
  } else {
    note = { title, body, tags, createdAt: now, updatedAt: now };
  }
  const savedNote = await saveNote(note);
  currentNoteId = savedNote.id;
  await renderNotesList();
  await renderTagsList();
  addScore(10);
  alert('Заметка сохранена!');
}

async function autoSaveCurrentNote() {
  if (!currentNoteId) return;
  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  const tags = getTagsFromInput();
  if (!title && !body) return;
  const notes = await getAllNotes();
  const existingNote = notes.find((item) => item.id === currentNoteId);
  if (!existingNote) return;
  const savedNote = await saveNote({ ...existingNote, title, body, tags, createdAt: existingNote.createdAt, updatedAt: Date.now() });
  await renderTagsList();
  currentNoteId = savedNote.id;
}

async function deleteCurrentNote() {
  if (!currentNoteId) {
    alert('Сначала откройте заметку, которую хотите удалить.');
    return;
  }
  if (!confirm('Удалить текущую заметку?')) return;
  await deleteNoteById(currentNoteId);
  await renderNotesList();
  newNote();
  addScore(5);
}

function normalizeTaskMarkers(markdown) {
  return markdown.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[([>\/!-])\](.*)$/gm, '$1[ ]$3');
}

function convertInternalLinksToMarkdown(markdown) {
  return markdown.replace(/\[\[([^\|\]]+)(?:\|([^\]]+))?\]\]/g, (match, rawTitle, rawAlias) => {
    const title = rawTitle.trim();
    const text = (rawAlias || rawTitle).trim();
    const href = `internal:${encodeURIComponent(title)}`;
    return `[${text}](${href})`;
  });
}

function renderPreview() {
  const markdownText = normalizeTaskMarkers(bodyInput.value);
  const markdownWithInternalLinks = convertInternalLinksToMarkdown(markdownText);
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
  const checkboxes = previewContainerEl.querySelectorAll('input[type="checkbox"]');
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
    if (!href.startsWith('internal:')) continue;
    link.classList.add('internal-link');
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const encodedTitle = href.slice('internal:'.length);
      const noteTitle = decodeURIComponent(encodedTitle);
      await handleInternalLinkClick(noteTitle);
    });
  }
}

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

async function handleInternalLinkClick(noteTitle) {
  console.log('Клик по ссылке на:', noteTitle);
  const note = await findNoteByTitle(noteTitle);
  if (note) {
    openNote(note);
  } else {
    const ok = confirm(`Создать заметку "${noteTitle}"?`);
    if (ok) {
      const now = Date.now();
      const newNote = { title: noteTitle, body: '', createdAt: now, updatedAt: now };
      const savedNote = await saveNote(newNote);
      openNote({ ...newNote, id: savedNote.id, syncId: savedNote.syncId });
      await renderNotesList();
      addScore(10);
    }
  }
}

async function toggleEditMode() {
  isEditMode = !isEditMode;
  const editToggleBtn = document.getElementById('editToggleBtn');
  if (isEditMode) {
    bodyInput.style.display = 'block';
    previewContainerEl.style.display = 'none';
    tagsEditorEl.style.display = 'block';
    noteTagsViewEl.style.display = 'none';
    editToggleBtn.title = 'Просмотр';
    bodyInput.focus();
  } else {
    bodyInput.style.display = 'none';
    previewContainerEl.style.display = 'block';
    tagsEditorEl.style.display = 'none';
    noteTagsViewEl.style.display = '';
    editToggleBtn.title = 'Редактировать';
    await autoSaveCurrentNote();
    renderNoteTags({ title: titleInput.value, tags: getTagsFromInput() });
    renderPreview();
  }
}

function newNote() {
  currentNoteId = null;
  titleInput.value = '';
  bodyInput.value = '';
  tagsInput.value = '';
  noteTagsViewEl.innerHTML = '';
  noteTagsViewEl.classList.remove('visible');
  setTagsEditorVisible(true);
  titleInput.focus();
}

// =========================
// 4) Автооткрытие/автосоздание заметки на сегодня
// =========================

async function openOrCreateTodayDaily() {
  const todayTitle = getTodayDailyTitle();
  let note = await findNoteByTitle(todayTitle);

  if (!note) {
    const now = Date.now();
    const saved = await saveNote({
      title: todayTitle,
      body: '',
      createdAt: now,
      updatedAt: now
    });
    note = await findNoteByTitle(todayTitle);
    if (!note) {
      note = {
        id: saved.id,
        syncId: saved.syncId,
        title: todayTitle,
        body: '',
        tags: [],
        createdAt: now,
        updatedAt: now
      };
    }
  }

  openNote(note);
}

async function enableEncryptionForExistingNotes(password) {
  if (encryptionConfig) {
    throw new Error('Шифрование уже настроено.');
  }

  if (!password || password.length < 12) {
    throw new Error('Пароль должен содержать не менее 12 символов.');
  }

  // Пока шифрование не включено, здесь получаем текущие plain-заметки.
  const notesToEncrypt = await getAllNotes();

  // Создаёт новую соль, конфиг и загружает новый ключ в masterKey.
  await createEncryptionConfig(password);

  let encryptedCount = 0;

  for (const note of notesToEncrypt) {
    // У заметки есть id, поэтому saveNote обновляет эту же запись,
    // а не создаёт дубликат. При включённом encryptionEnabled
    // saveNote автоматически зашифрует title, body и tags.
    await saveNote({
      ...note,
      id: note.id,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    });

    encryptedCount += 1;
  }

  return encryptedCount;
}

async function enableEncryptionWithPassword() {
  const existingConfig = await new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(SETTINGS_STORE_NAME, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE_NAME);
      const request = store.get(CRYPTO_SETTINGS_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (err) { reject(err); }
  });
  if (existingConfig) {
    console.log('Шифрование уже настроено, пропускаем enableEncryptionWithPassword');
    return;
  }
  const password = prompt('Введите пароль для включения шифрования (минимум 12 символов):');
  if (!password) return;
  if (password.length < 12) {
    alert('Пароль должен содержать не менее 12 символов.');
    return;
  }
  try {
    await createEncryptionConfig(password);
    const salt = base64ToBytes(encryptionConfig.kdf.salt);
    masterKey = await deriveMasterKey(password, salt);
    encryptionEnabled = true;
    alert('Шифрование включено.\n\nТеперь новые и изменённые заметки будут зашифрованы.\nСтарые заметки останутся в незашифрованном виде.');
    location.reload();
  } catch (err) {
    console.error('Ошибка при включении шифрования:', err);
    alert('Не удалось включить шифрование. Проверьте консоль разработчика.');
  }
}

// =========================
// 5) Настройки: смена пароля
// =========================

async function changeEncryptionPassword() {
  if (!encryptionConfig || !masterKey || !encryptionEnabled) {
    alert('Сначала разблокируйте шифрование.');
    return;
  }

  const oldPassword = prompt('Введите текущий пароль шифрования:');
  if (!oldPassword) return;

  try {
    await unlockEncryption(oldPassword);
  } catch (error) {
    alert('Неверный текущий пароль.');
    return;
  }

  const newPassword = prompt('Введите новый пароль шифрования (минимум 12 символов):');
  if (!newPassword || newPassword.length < 12) {
    alert('Пароль должен содержать не менее 12 символов.');
    return;
  }

  const allNotes = await getAllNotes();
  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const newKey = await deriveMasterKey(newPassword, newSalt);
  const newVerifier = await encryptJson(
    { purpose: 'logbook-password-verifier', version: CRYPTO_VERSION },
    newKey
  );

  const newConfig = {
    version: CRYPTO_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(newSalt)
    },
    cipher: { name: 'AES-GCM', keyLength: 256 },
    verifier: newVerifier,
    createdAt: Date.now()
  };

  for (const note of allNotes) {
    await saveNoteWithKey(note, newKey);
  }

  await saveEncryptionConfig(newConfig);
  encryptionConfig = newConfig;
  masterKey = newKey;
  encryptionEnabled = true;

  alert('Пароль успешно изменён.');
}

async function saveNoteWithKey(note, key) {
  const normalizedNote = normalizeNote(note);
  const payload = {
    title: normalizedNote.title || '',
    body: normalizedNote.body || '',
    tags: normalizedNote.tags || []
  };
  const encryptedData = await encryptJson(payload, key);
  const record = {
    id: normalizedNote.id,
    syncId: normalizedNote.syncId,
    encrypted: true,
    data: encryptedData,
    createdAt: normalizedNote.createdAt,
    updatedAt: normalizedNote.updatedAt
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const request = tx.objectStore(STORE_NAME).put(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// =========================
// 6) Инициализация приложения
// =========================

async function initApp() {
  await openDB();
  await loadEncryptionConfig();

  console.log('encryptionConfig после load:', encryptionConfig);
  console.log('encryptionEnabled после load:', encryptionEnabled);

  // Смотрим записи напрямую, до расшифровки.
  // Это защищает от опасной ситуации: зашифрованные заметки есть,
  // а конфиг утерян. Новый пароль в таком случае создавать нельзя.
  const rawNotes = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });

  const hasEncryptedNotes = rawNotes.some((note) => note.encrypted === true);
  let encryptionCreatedThisSession = false;

  if (!encryptionConfig && hasEncryptedNotes) {
    appLocked = true;
    alert(
        'Найдены зашифрованные заметки, но настройки шифрования не найдены.\n\n' +
        'Новый пароль создавать нельзя: он не откроет старые заметки.\n' +
        'Откройте прежнюю копию приложения или восстановите резервную копию.'
    );
  } else if (!encryptionConfig) {
    const shouldEnable = confirm(
        'Шифрование заметок пока не включено. Настроить пароль сейчас?'
    );

    if (shouldEnable) {
      const password = prompt('Введите пароль шифрования (минимум 12 символов):');

      if (password && password.length >= 12) {
        const encryptedCount = await enableEncryptionForExistingNotes(password);
        encryptionCreatedThisSession = true;

        alert(
            'Шифрование включено.\n\n' +
            `Зашифровано заметок: ${encryptedCount}`
        );
      } else if (password) {
        alert('Пароль должен содержать не менее 12 символов.');
      }
    }
  }

  const attemptsRecord = await requestToPromise( // --- Это строка 1515 ---
      getSettingsStore().get('maxPasswordAttempts')
  );
  const maxAttempts = Number(attemptsRecord?.value) || 7;

  // Счётчик действует только в рамках текущего запуска страницы.
  // После верного пароля он явно сбрасывается в 0.
  let failedAttempts = 0;

  if (!appLocked && encryptionConfig && !encryptionCreatedThisSession) {
    let unlocked = false;

    while (!unlocked) {
      const left = maxAttempts - failedAttempts;
      const password = prompt(
          'Шифрование включено.\n' +
          'Введите пароль для расшифровки заметок.\n' +
          `Осталось попыток: ${left}\n` +
          '(Отмена закроет приложение)'
      );

      if (!password) {
        appLocked = true;
        alert('Приложение заблокировано. Перезагрузите страницу, чтобы ввести пароль.');
        break;
      }

      try {
        await unlockEncryption(password);
        encryptionEnabled = true;
        failedAttempts = 0;
        unlocked = true;
        appLocked = false;
        console.log('Шифрование разблокировано, ключ загружен.');
      } catch (err) {
        console.error('Ошибка при расшифровке:', err);
        failedAttempts += 1;

        if (failedAttempts >= maxAttempts) {
          appLocked = true;
          alert('Превышено число попыток. Приложение заблокировано.');
          break;
        }

        alert(`Неверный пароль. Осталось попыток: ${maxAttempts - failedAttempts}`);
      }
    }
  } else if (!appLocked && encryptionCreatedThisSession) {
    // createEncryptionConfig уже положила ключ в masterKey.
    encryptionEnabled = true;
  } else if (!appLocked && !encryptionConfig) {
    encryptionEnabled = false;
  }

  if (appLocked) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif;text-align:center;padding:20px">
        <div>
          <h1>Приложение заблокировано</h1>
          <p>Для доступа к заметкам перезагрузите страницу и введите пароль.</p>
        </div>
      </div>
    `;
    return;
  }

  await migrateExistingNotesForSync();

  await openOrCreateTodayDaily();
  await renderNotesList();
  setupMenuSections();
  await renderTagsList();

  if (currentNoteId) {
    backHistory.push(currentNoteId);
    renderRecentList();
  }

  initCalendarSelectors();

  const editToggleBtn = document.getElementById('editToggleBtn');
  editToggleBtn.onclick = () => toggleEditMode();

  const menuBtn = document.getElementById('menuBtn');
  const menuOverlayEl = document.getElementById('menuOverlay');
  const calendarOverlayEl = document.getElementById('calendarOverlay');
  const closeMenuBtn = document.getElementById('closeMenuBtn');

  function closeMenuOverlay() {
    menuOverlayEl.classList.remove('open');
    menuOverlayEl.setAttribute('aria-hidden', 'true');
    menuBtn.title = 'Меню';
  }

  function openMenuOverlay() {
    calendarOverlayEl.classList.remove('open');
    calendarOverlayEl.setAttribute('aria-hidden', 'true');

    const drawer = document.getElementById('drawer');
    if (drawer) drawer.classList.add('open');

    menuOverlayEl.classList.add('open');
    menuOverlayEl.setAttribute('aria-hidden', 'false');
    menuBtn.title = 'Закрыть меню';

    renderNotesList();
    renderRecentList();
    renderTagsList();
  }

  menuBtn.onclick = () => {
    if (menuOverlayEl.classList.contains('open')) closeMenuOverlay();
    else openMenuOverlay();
  };

  closeMenuBtn.onclick = closeMenuOverlay;
  menuOverlayEl.onclick = (event) => {
    if (event.target === menuOverlayEl) closeMenuOverlay();
  };

  const calendarBtn = document.getElementById('calendarBtn');
  calendarBtn.onclick = async () => {
    closeMenuOverlay();
    calendarOverlayEl.classList.add('open');
    calendarOverlayEl.setAttribute('aria-hidden', 'false');
    await openCalendarPanel();
  };

  closeCalendarBtnEl.onclick = () => closeCalendarPanel();
  calendarOverlayEl.onclick = (event) => {
    if (event.target === calendarOverlayEl) closeCalendarPanel();
  };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (menuOverlayEl.classList.contains('open')) closeMenuOverlay();
    if (calendarOverlayEl.classList.contains('open')) closeCalendarPanel();
  });

  document.getElementById('deleteNoteBtn').onclick = deleteCurrentNote;

  const claimDailyBtn = document.getElementById('claimDailyBtn');
  if (claimDailyBtn) claimDailyBtn.onclick = claimDailyBonus;

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

  // --- Settings ---
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const enableEncryptionCheckbox = document.getElementById('enableEncryptionCheckbox');
  const passwordSection = document.getElementById('passwordSection');
  const encryptionPasswordInput = document.getElementById('encryptionPasswordInput');
  const savePasswordBtn = document.getElementById('savePasswordBtn');
  const changePasswordBtn = document.getElementById('changePasswordBtn');
  const maxAttemptsInput = document.getElementById('maxAttemptsInput');
  const saveMaxAttemptsBtn = document.getElementById('saveMaxAttemptsBtn');

  function closeSettings() {
    settingsOverlay.classList.remove('open');
    settingsOverlay.setAttribute('aria-hidden', 'true');
  }

  if (settingsBtn && settingsOverlay) {
    settingsBtn.onclick = async () => {
      const record = await requestToPromise(
          getSettingsStore().get(CRYPTO_SETTINGS_KEY)
      );
      const config = record?.value || encryptionConfig;

      enableEncryptionCheckbox.checked = Boolean(config);
      passwordSection.style.display = config ? 'block' : 'none';
      savePasswordBtn.style.display = config ? 'none' : 'inline-flex';
      changePasswordBtn.style.display = config ? 'inline-flex' : 'none';

      const settingsAttemptsRecord = await requestToPromise(
          getSettingsStore().get('maxPasswordAttempts')
      );
      maxAttemptsInput.value = settingsAttemptsRecord?.value || 7;

      settingsOverlay.classList.add('open');
      settingsOverlay.setAttribute('aria-hidden', 'false');
    };
  }

  if (closeSettingsBtn) {
    closeSettingsBtn.onclick = closeSettings;
  }

  settingsOverlay.onclick = (event) => {
    if (event.target === settingsOverlay) closeSettings();
  };

  if (enableEncryptionCheckbox && passwordSection) {
    enableEncryptionCheckbox.onchange = () => {
      passwordSection.style.display = enableEncryptionCheckbox.checked ? 'block' : 'none';
    };
  }

  if (savePasswordBtn) {
    savePasswordBtn.onclick = async () => {
      const password = encryptionPasswordInput.value;
      if (!password || password.length < 12) {
        alert('Пароль должен содержать не менее 12 символов.');
        return;
      }

      try {
        const encryptedCount = await enableEncryptionForExistingNotes(password);

        encryptionPasswordInput.value = '';
        alert(
            'Шифрование включено.\n\n' +
            `Зашифровано заметок: ${encryptedCount}`
        );
        closeSettings();
      } catch (error) {
        console.error('Ошибка включения шифрования:', error);
        alert('Не удалось включить шифрование.');
      }
    };
  }

  if (changePasswordBtn) {
    changePasswordBtn.onclick = changeEncryptionPassword;
  }

  if (saveMaxAttemptsBtn) {
    saveMaxAttemptsBtn.onclick = async () => {
      const attempts = Number.parseInt(maxAttemptsInput.value, 10);
      if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) {
        alert('Количество попыток должно быть от 1 до 20.');
        return;
      }

      const store = getSettingsStore('readwrite');
      await requestToPromise(store.put({
        key: 'maxPasswordAttempts',
        value: attempts
      }));
      alert('Настройка сохранена.');
    };
  }
}

// =========================
// 7) Календарь
// =========================

const calendarPanelEl = document.getElementById('calendarPanel');
const calendarMonthSelectEl = document.getElementById('calendarMonthSelect');
const calendarYearSelectEl = document.getElementById('calendarYearSelect');
const calendarWeekdaysGridEl = document.getElementById('calendarWeekdaysGrid');
const calendarDaysGridEl = document.getElementById('calendarDaysGrid');
const closeCalendarBtnEl = document.getElementById('closeCalendarBtn');

let calendarCurrentMonth = getTodayDateParts().month;
let calendarCurrentYear = getTodayDateParts().year;

function initCalendarSelectors() {
  calendarMonthSelectEl.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = MONTH_SELECT_NAMES[i];
    calendarMonthSelectEl.appendChild(opt);
  }
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
  calendarMonthSelectEl.value = String(calendarCurrentMonth);
  calendarYearSelectEl.value = String(calendarCurrentYear);
  calendarMonthSelectEl.addEventListener('change', () => {
    calendarCurrentMonth = parseInt(calendarMonthSelectEl.value, 10);
    renderCalendar();
  });
  calendarYearSelectEl.addEventListener('change', () => {
    calendarCurrentYear = parseInt(calendarYearSelectEl.value, 10);
    renderCalendar();
  });
}

function renderCalendarWeekdaysHeader() {
  calendarWeekdaysGridEl.innerHTML = '';
  for (const name of WEEKDAY_HEADER_NAMES) {
    const cell = document.createElement('div');
    cell.className = 'calendarWeekday';
    cell.textContent = name;
    calendarWeekdaysGridEl.appendChild(cell);
  }
}

async function renderCalendarDaysGrid() {
  calendarDaysGridEl.innerHTML = '';
  const month = calendarCurrentMonth;
  const year = calendarCurrentYear;
  const daysInMonth = getDaysInMonth(month, year);
  const firstDayJsWeekday = getFirstDayWeekday(month, year);
  const firstDayMonFirst = jsWeekdayToMonFirst(firstDayJsWeekday);
  const dailyDatesSet = await getDailyNotesDatesSet();
  const todayParts = getTodayDateParts();
  const isCurrentMonthToday = todayParts.month === month && todayParts.year === year;

  for (let i = 0; i < firstDayMonFirst; i++) {
    const emptyCell = document.createElement('div');
    calendarDaysGridEl.appendChild(emptyCell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendarCell';
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasNote = dailyDatesSet.has(dateKey);
    if (hasNote) cell.classList.add('hasNote');
    if (isCurrentMonthToday && day === todayParts.day) cell.classList.add('today');
    cell.textContent = String(day).padStart(2, '0');
    cell.onclick = () => handleCalendarDayClick(day, month, year);
    calendarDaysGridEl.appendChild(cell);
  }
}

async function handleCalendarDayClick(day, month, year) {
  const title = formatDailyTitleFromParts(day, month, year);
  const note = await findNoteByTitle(title);
  if (note) {
    openNote(note);
    closeCalendarPanel();
  } else {
    const ok = confirm(`Создать заметку на ${title}?`);
    if (ok) {
      const now = Date.now();
      const newNote = { title, body: '', createdAt: now, updatedAt: now };
      const savedNote = await saveNote(newNote);
      openNote({ ...newNote, id: savedNote.id, syncId: savedNote.syncId });
      closeCalendarPanel();
      await renderNotesList();
      await renderCalendarDaysGrid();
      addScore(10);
    }
  }
}

async function renderCalendar() {
  renderCalendarWeekdaysHeader();
  await renderCalendarDaysGrid();
}

async function openCalendarPanel() {
  const today = getTodayDateParts();
  calendarCurrentMonth = today.month;
  calendarCurrentYear = today.year;
  calendarMonthSelectEl.value = String(calendarCurrentMonth);
  calendarYearSelectEl.value = String(calendarCurrentYear);
  calendarPanelEl.classList.add('open');
  await renderCalendar();
}

function closeCalendarPanel() {
  const calendarOverlayEl = document.getElementById('calendarOverlay');
  calendarPanelEl.classList.remove('open');
  calendarOverlayEl.classList.remove('open');
  calendarOverlayEl.setAttribute('aria-hidden', 'true');
}

// Запуск приложения
initApp().catch((err) => {
  console.error('Ошибка инициализации приложения:', err);
  alert('Не удалось инициализировать приложение. Проверьте консоль разработчика.');
});