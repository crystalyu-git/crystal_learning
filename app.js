/* =============================================
   CRYSTAL LEARNING - Spaced Repetition System
   Application Logic
   ============================================= */

// ── Auth ──
const APP_PASSWORD = 'crystalcrystal';
const AUTH_KEY = 'crystal_auth';

// ── Spaced Repetition Intervals (in days) ──
const INTERVALS = [0, 1, 2, 4, 7, 15, 30]; // Level 0-6

// ── State ──
let cards = [];
let reviewQueue = [];
let currentReviewIndex = 0;
let reviewStats = { total: 0, correct: 0, wrong: 0 };
let deleteTargetId = null;
let isOnline = false;

// 手動／自動「更新雲端資料」用的狀態
let isRefreshing = false; // 防止連點時重複打 API
let lastSyncAt = 0; // 上次成功同步的時間戳，供自動更新節流
const AUTO_REFRESH_MIN_GAP = 60 * 1000; // 60 秒內切進切出不重複同步

// Habit Tracker
let habits = []; // [{ id, name, createdAt }]
let habitChecks = {}; // { [habitId]: { "YYYY-MM-DD": true } }
let cardChecks = {}; // { [cardId]: { "YYYY-MM-DD": true } } — 知識庫卡片每日打卡紀錄
let habitScrollInitialized = false;
const HABIT_MAX_MONTHS_BACK = 11; // 打卡表最多回溯 11 個月，避免表格無限成長

// Language Filter: persisted in localStorage
let currentLangFilter = localStorage.getItem('crystal_lang_filter') || 'all';

// ── DOM Elements ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Inline Icons ──
// 動態產生的 icon，樣式跟 index.html 裡的線條 icon 一致（Feather 風格）
const svgIcon = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICON_INBOX = svgIcon('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>');
const ICON_SEARCH = svgIcon('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>');

// ── Database Proxy API URL ──
// 含 getAudio 端點的部署（iOS 播 Drive 音檔要靠它）
const DEFAULT_NOTION_URL = 'https://script.google.com/macros/s/AKfycbwTp_1PYsL9eAoAtL8AzTCT_EPssN3_KsOXKhPQrQ9F6Bw2LWMNYFU-F8Nk8-ruRkIrZw/exec';
// Old deprecated URLs — auto-migrate if still stored on this device
const _OLD_NOTION_URLS = [
  'https://script.google.com/macros/s/AKfycbwYDvfHI5XNMhwmF8v4KC7hCOs_xHQXNjelVriO5cpWOu0lxduFcBa40Ex6-CPwWF2q/exec',
  'https://script.google.com/macros/s/AKfycbyi3PtLL5wwEdx2feSYHiaRC0FrF-9YXI3P-WXdfVVg0Bmz3ClOs5JKurwkaz69Fw9POA/exec',
];
(function migrateNotionUrl() {
  const stored = localStorage.getItem('crystal_learning_notion_url');
  // If stored value is an old URL or empty string, clear it so DEFAULT_NOTION_URL takes effect
  if (_OLD_NOTION_URLS.includes(stored) || stored === '') {
    localStorage.removeItem('crystal_learning_notion_url');
  }
})();

function getNotionProxyUrl() {
  return DEFAULT_NOTION_URL;
}

function adjustHexToRgba(hex, percent, alpha) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  let r = parseInt(hex.substring(0, 2), 16) || 0;
  let g = parseInt(hex.substring(2, 4), 16) || 0;
  let b = parseInt(hex.substring(4, 6), 16) || 0;
  if (percent > 0) {
    r = Math.min(255, Math.floor(r + (255 - r) * (percent / 100)));
    g = Math.min(255, Math.floor(g + (255 - g) * (percent / 100)));
    b = Math.min(255, Math.floor(b + (255 - b) * (percent / 100)));
  } else if (percent < 0) {
    const factor = 1 + (percent / 100);
    r = Math.max(0, Math.floor(r * factor));
    g = Math.max(0, Math.floor(g * factor));
    b = Math.max(0, Math.floor(b * factor));
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Theme Customization ──

function hexToHsl(hex) {
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max == min) {
    h = s = 0;
  } else {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getSecondaryAccent(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const newH = (hsl[0] + 35) % 360; // Shift hue by 35 degrees up
  return hslToHex(newH, hsl[1], hsl[2]);
}

function applyTheme(theme) {
  const root = document.documentElement;

  if (theme.accentPrimary) {
    const secondary = getSecondaryAccent(theme.accentPrimary);
    root.style.setProperty('--accent-primary', theme.accentPrimary);
    root.style.setProperty('--accent-secondary', secondary);
    root.style.setProperty('--text-accent', theme.accentPrimary);
    root.style.setProperty('--gradient-primary', theme.accentPrimary);
    if ($('#colorAccent')) $('#colorAccent').value = theme.accentPrimary;
  } else {
    root.style.removeProperty('--accent-primary');
    root.style.removeProperty('--accent-secondary');
    root.style.removeProperty('--text-accent');
    root.style.removeProperty('--gradient-primary');
    if ($('#colorAccent')) $('#colorAccent').value = '#6366f1';
  }

  if (theme.bgPrimary) {
    root.style.setProperty('--bg-primary', theme.bgPrimary);
    root.style.setProperty('--bg-header', adjustHexToRgba(theme.bgPrimary, -25, 0.85));
    root.style.setProperty('--bg-card', theme.bgCard || adjustHexToRgba(theme.bgPrimary, -15, 0.6));
    root.style.setProperty('--bg-card-hover', theme.bgCardHover || adjustHexToRgba(theme.bgPrimary, -5, 0.7));
    if ($('#colorBgPrimary')) $('#colorBgPrimary').value = theme.bgPrimary;
  } else {
    root.style.removeProperty('--bg-primary');
    root.style.removeProperty('--bg-header');
    root.style.removeProperty('--bg-card');
    root.style.removeProperty('--bg-card-hover');
    if ($('#colorBgPrimary')) $('#colorBgPrimary').value = '#0a0a1a';
  }

  // 文字色與玻璃效果覆蓋（淺色主題自動偵測）
  const isLightBg = (() => {
    if (!theme.bgPrimary) return false;
    const hex = theme.bgPrimary.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  })();
  const lightDefaults = { textPrimary: '#555555', textSecondary: '#606060', textMuted: '#5a5a5a', bgGlass: 'rgba(0,0,0,0.06)', borderLight: 'rgba(0,0,0,0.12)' };
  const textVars = ['--text-primary', '--text-secondary', '--text-muted', '--bg-glass', '--border-light'];
  const textKeys = ['textPrimary', 'textSecondary', 'textMuted', 'bgGlass', 'borderLight'];
  textKeys.forEach((key, i) => {
    if (theme[key]) root.style.setProperty(textVars[i], theme[key]);
    else if (isLightBg) root.style.setProperty(textVars[i], lightDefaults[key]);
    else root.style.removeProperty(textVars[i]);
  });

  updateFavicon();
}

// 品牌圖示（與 nav-brand / login-brand 同一組路徑）
// canvas 光柵化時 SVG 必須帶 width/height，否則 Safari 會畫不出來
function buildBrandSvg(accent, size) {
  const wh = size ? ` width='${size}' height='${size}'` : '';
  return `<svg xmlns='http://www.w3.org/2000/svg'${wh} viewBox='0 0 28 28'><path d='M14 2L2 8L14 14L26 8L14 2Z' stroke='${accent}' stroke-width='2' fill='none'/><path d='M2 20L14 26L26 20' stroke='${accent}' stroke-width='2' fill='none'/><path d='M2 14L14 20L26 14' stroke='${accent}' stroke-width='2' fill='none'/></svg>`;
}

// 手機端多半不吃 SVG favicon（iOS Safari 完全不支援），改用 canvas 產生 PNG
// bgColor 有值時填實心底色：iOS 加入主畫面會把透明背景填成黑色
function renderBrandPng(size, accent, bgColor) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        let pad = 0;
        if (bgColor) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, size, size);
          pad = Math.round(size * 0.16); // 留邊，避免 iOS 圓角把圖示切掉
        }
        ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml,' + encodeURIComponent(buildBrandSvg(accent, size));
  });
}

function appendIconLink(rel, href, type, sizes) {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  if (type) link.type = type;
  if (sizes) link.sizes = sizes;
  document.head.appendChild(link);
}

// 依目前主題色（--accent-primary）重新產生 favicon（桌機 SVG + 手機 PNG 同一套規則）
// 瀏覽器對「同一個 <link> 只改 href」不一定會重新讀取，要整個換掉節點才會生效
let faviconToken = 0;
function updateFavicon() {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue('--accent-primary').trim() || '#6366f1';
  const bg = cs.getPropertyValue('--bg-primary').trim() || '#0a0a1a';

  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(el => el.remove());
  appendIconLink('icon', 'data:image/svg+xml,' + encodeURIComponent(buildBrandSvg(accent)), 'image/svg+xml');

  // PNG 是非同步產生的，期間若又換過主題就丟棄這批結果
  const token = ++faviconToken;
  Promise.all([
    renderBrandPng(64, accent, null),   // 手機瀏覽器分頁：透明底
    renderBrandPng(192, accent, null),
    renderBrandPng(180, accent, bg)     // iOS 加入主畫面：實心底
  ]).then(([png64, png192, png180]) => {
    if (token !== faviconToken) return;
    appendIconLink('icon', png64, 'image/png', '64x64');
    appendIconLink('icon', png192, 'image/png', '192x192');
    appendIconLink('apple-touch-icon', png180, 'image/png', '180x180');
  }).catch(() => { });
}

function loadTheme() {
  const saved = localStorage.getItem('crystal_learning_theme');
  if (saved) {
    try {
      applyTheme(JSON.parse(saved));
    } catch (e) { }
  }
}

function saveTheme(theme) {
  localStorage.setItem('crystal_learning_theme', JSON.stringify(theme));
}

// ── YouTube IFrame API Support ──
let ytPlayer = null;
let ytPlayerReady = false;
let ytCurrentVideoId = null;

function loadYouTubeAPI() {
  if (window.YT) return;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  const firstScriptTag = document.getElementsByTagName('script')[0];
  if (firstScriptTag) {
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
  } else {
    document.head.appendChild(tag);
  }
}

window.onYouTubeIframeAPIReady = function() {
  const div = document.createElement('div');
  div.id = 'yt-player-container';
  div.style.display = 'none';
  document.body.appendChild(div);
  
  ytPlayer = new YT.Player('yt-player-container', {
    height: '0',
    width: '0',
    videoId: '',
    events: {
      'onReady': () => { ytPlayerReady = true; }
    }
  });
};

function extractYouTubeId(url) {
  const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// ── Auth ──
function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === '1';
}

function showLoginScreen() {
  $('#navbar').style.display = 'none';
  document.querySelector('.main-content').style.display = 'none';

  const loginScreen = $('#loginScreen');
  loginScreen.style.display = 'flex';

  const input = $('#loginInput');
  const btn = $('#loginBtn');
  const error = $('#loginError');

  const attempt = () => {
    if (input.value === APP_PASSWORD) {
      localStorage.setItem(AUTH_KEY, '1');
      loginScreen.style.display = 'none';
      $('#navbar').style.display = '';
      document.querySelector('.main-content').style.display = '';
      initApp();
    } else {
      error.style.display = 'block';
      input.value = '';
      input.focus();
    }
  };

  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  input.focus();
}

// ── Initialize ──
async function initApp() {
  loadYouTubeAPI();
  loadCardsFromLocal();
  loadHabitsFromLocal();
  initParticles();
  initNavigation();
  initLangToggle();
  initAddForm();
  initReview();
  initLibrary();
  initHabitTracker();
  initModal();
  initSettings();
  initAudioActions();
  initSmartInput();
  updateDateDisplay();

  // Apply language context to start
  updateLanguageContextText();
  renderLangFilterBars();
  updateDashboard();
  renderLibrary();
  updateCategoryDatalist();

  // Try to connect to Notion Proxy
  if (getNotionProxyUrl()) {
    await syncFromNotion();
    lastSyncAt = Date.now(); // 別讓下面的自動更新一開場就再打一次
  }

  initAutoRefresh();
}

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  if (!isAuthenticated()) {
    showLoginScreen();
  } else {
    initApp();
  }
});

// ── LocalStorage ──
function loadCardsFromLocal() {
  try {
    const data = localStorage.getItem('crystal_learning_cards');
    cards = data ? JSON.parse(data) : [];
  } catch (e) {
    cards = [];
  }
}

function saveCardsToLocal() {
  localStorage.setItem('crystal_learning_cards', JSON.stringify(cards));
  updateCategoryDatalist();
  renderLangFilterBars();
}

// ── Habit Tracker: LocalStorage ──
function loadHabitsFromLocal() {
  try {
    const data = localStorage.getItem('crystal_habit_list');
    habits = data ? JSON.parse(data) : [];
  } catch (e) {
    habits = [];
  }
  try {
    const data = localStorage.getItem('crystal_habit_checks');
    habitChecks = data ? JSON.parse(data) : {};
  } catch (e) {
    habitChecks = {};
  }
  try {
    const data = localStorage.getItem('crystal_card_checks');
    cardChecks = data ? JSON.parse(data) : {};
  } catch (e) {
    cardChecks = {};
  }
}

function saveHabitsToLocal() {
  localStorage.setItem('crystal_habit_list', JSON.stringify(habits));
}

function saveHabitChecksToLocal() {
  localStorage.setItem('crystal_habit_checks', JSON.stringify(habitChecks));
}

function saveCardChecksToLocal() {
  localStorage.setItem('crystal_card_checks', JSON.stringify(cardChecks));
}

// ── Database Proxy API ──
const NotionAPI = {
  async loadAll() {
    const url = getNotionProxyUrl();
    if (!url) return null;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) return data.cards;
    throw new Error(data.error || 'Failed to load');
  },

  async saveCard(card) {
    const url = getNotionProxyUrl();
    if (!url) return;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'save', card }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Save failed');
    return json;
  },

  async deleteCard(id) {
    const url = getNotionProxyUrl();
    if (!url) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'delete', id }),
    });
  },

  async syncAll(cardsData) {
    const url = getNotionProxyUrl();
    if (!url) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'sync', cards: cardsData }),
    });
  },

  async uploadAudio(base64Data, filename, mimeType, lang) {
    const url = getNotionProxyUrl();
    if (!url) throw new Error('No proxy URL configured');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'uploadAudio', base64Data, filename, mimeType, lang }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Upload failed');
    return json.url;
  },

  async deleteAudio(fileId) {
    const url = getNotionProxyUrl();
    if (!url) return;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'deleteAudio', fileId }),
    });
    const json = await res.json();
    return json;
  },
};

// ── Sync functions ──
async function syncFromNotion() {
  const url = getNotionProxyUrl();
  if (!url) {
    updateSyncStatus('offline');
    return;
  }
  updateSyncStatus('syncing');
  try {
    const notionCards = await NotionAPI.loadAll();
    if (notionCards && notionCards.length > 0) {
      // ── Extract hidden streak card ──
      const streakCard = notionCards.find(c => c.id === STREAK_CARD_ID);
      if (streakCard) {
        const notionStreak = { count: streakCard.level || 0, lastDate: streakCard.example || null };
        const localStreak = loadStreak();
        // Keep whichever has a more recent lastDate (or higher count if dates equal)
        const notionDate = notionStreak.lastDate ? new Date(notionStreak.lastDate).getTime() : 0;
        const localDate = localStreak.lastDate ? new Date(localStreak.lastDate).getTime() : 0;
        if (notionDate > localDate || (notionDate === localDate && notionStreak.count > localStreak.count)) {
          saveStreak(notionStreak, false); // update local only, don't re-push
        }
      }

      // ── Extract hidden habit tracker card ──
      const habitsCard = notionCards.find(c => c.id === HABITS_CARD_ID);
      if (habitsCard) {
        try {
          const notionData = JSON.parse(habitsCard.meaning || '{}');
          const notionUpdatedAt = Number(habitsCard.example) || 0;
          const localUpdatedAt = Number(localStorage.getItem('crystal_habit_updated_at')) || 0;
          // Keep whichever side was updated more recently
          if (notionUpdatedAt > localUpdatedAt) {
            habits = notionData.habits || [];
            habitChecks = notionData.habitChecks || {};
            cardChecks = notionData.cardChecks || {};
            saveHabitsToLocal();
            saveHabitChecksToLocal();
            saveCardChecksToLocal();
          } else if (localUpdatedAt > notionUpdatedAt) {
            pushHabitsToNotion();
          }
        } catch (e) {
          console.warn('Habit tracker data parse failed:', e);
        }
      } else if (habits.length > 0) {
        // Cloud has no habit data yet — seed it from local
        pushHabitsToNotion();
      }

      // ── 以資料庫為主（Source of Truth）全數覆寫本地端 ──
      const realNotionCards = notionCards.filter(c => c.id !== STREAK_CARD_ID && c.id !== HABITS_CARD_ID);
      cards = [...realNotionCards];
      saveCardsToLocal();
    } else if (cards.length > 0) {
      // Database is empty but local has data — push local to Database
      await NotionAPI.syncAll(cards);
      if (habits.length > 0) pushHabitsToNotion();
    }
    updateSyncStatus('connected');
    updateDashboard();
    renderHabitTracker();
    // 知識庫只在切頁時重繪，同步完成時若正停在這頁不補繪，
    // 會一直顯示同步前的「知識庫是空的」，要切走再切回來才看得到資料
    if ($('#libraryView') && $('#libraryView').classList.contains('active')) {
      renderLibrary();
    }
    return true;
  } catch (e) {
    console.warn('Database sync failed:', e);
    updateSyncStatus('error');
    return false;
  }
}

// 主動從資料庫拉最新資料並重繪畫面
// H5 加到主畫面後沒有網址列可以重新整理，靠點左上角 logo 圖示與切回 App 時自動觸發
async function refreshFromCloud({ silent = false } = {}) {
  if (isRefreshing) return;
  // 複習進行中不覆寫：cards 被整包換掉，正在看的那張卡片可能憑空消失
  if ($('#reviewView') && $('#reviewView').classList.contains('active') &&
      reviewQueue.length > 0 && currentReviewIndex < reviewQueue.length) {
    if (!silent) showToast('複習進行中，完成後再更新');
    return;
  }
  isRefreshing = true;
  const icon = $('.brand-icon');
  if (icon) icon.classList.add('refreshing');
  try {
    const ok = await syncFromNotion();
    if (ok) {
      lastSyncAt = Date.now();
      refreshActiveView();
    }
    if (!silent) showToast(ok ? '已更新為最新資料' : '更新失敗，請檢查連線');
  } finally {
    isRefreshing = false;
    if (icon) icon.classList.remove('refreshing');
  }
}

// syncFromNotion 只重繪儀表板／習慣追蹤／知識庫，
// 語言篩選列與分類清單會因為卡片被整包換掉而過期，這裡補繪
function refreshActiveView() {
  renderLangFilterBars();
  updateCategoryDatalist();
}

function initAutoRefresh() {
  const maybeRefresh = () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastSyncAt < AUTO_REFRESH_MIN_GAP) return;
    refreshFromCloud({ silent: true }); // 背景靜默更新，不跳提示
  };
  document.addEventListener('visibilitychange', maybeRefresh);
  // iOS 主畫面 web app 從背景復原時走 bfcache，visibilitychange 不一定會補發
  window.addEventListener('pageshow', (e) => { if (e.persisted) maybeRefresh(); });
}

// silent: 由呼叫端自己顯示錯誤訊息時用，避免跳出兩則提示
async function saveCardToNotion(card, { silent = false } = {}) {
  if (!getNotionProxyUrl()) return true; // 沒設後端就沒有雲端可失敗
  try {
    updateSyncStatus('syncing');
    await NotionAPI.saveCard(card);
    updateSyncStatus('connected');
    return true;
  } catch (e) {
    console.warn('Save to Database failed:', e);
    updateSyncStatus('error');
    if (!silent) showToast('儲存失敗: ' + (e.message || String(e)).substring(0, 50));
    return false;
  }
}

async function deleteCardFromNotion(id) {
  if (!getNotionProxyUrl()) return;
  try {
    updateSyncStatus('syncing');
    await NotionAPI.deleteCard(id);
    updateSyncStatus('connected');
  } catch (e) {
    console.warn('Delete from Database failed:', e);
    updateSyncStatus('error');
  }
}

// ── Drive Audio Helpers ──
// Extract Google Drive fileId from a share URL
function extractDriveFileId(url) {
  if (!url) return null;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Check if any OTHER card (besides excludeId) uses the same audioUrl fileId
function isAudioSharedWithOtherCards(fileId, excludeId) {
  return cards.some(c => c.id !== excludeId && extractDriveFileId(c.audioUrl) === fileId);
}

async function tryDeleteDriveAudio(fileId) {
  if (!fileId || !getNotionProxyUrl()) return;
  try {
    const result = await NotionAPI.deleteAudio(fileId);
    if (result && result.success) {
      showToast('音檔已從 Google Drive 刪除');
    } else {
      console.warn('[Audio Cleanup] Delete rejected (not in Crystal_Learning or error):', result);
    }
  } catch (e) {
    console.warn('[Audio Cleanup] Failed to delete audio:', e);
  }
}

function updateSyncStatus(status) {
  const dot = $('#syncDot');
  const label = $('#syncLabel');
  dot.className = 'sync-dot';
  isOnline = false;

  switch (status) {
    case 'connected':
      dot.classList.add('connected');
      label.textContent = '已連線';
      isOnline = true;
      break;
    case 'syncing':
      dot.classList.add('syncing');
      label.textContent = '同步中';
      break;
    case 'error':
      dot.classList.add('error');
      label.textContent = '連線失敗';
      break;
    default:
      label.textContent = '未連線';
  }
}

function showLoading(text = '同步中...') {
  $('#loadingText').textContent = text;
  $('#loadingOverlay').classList.add('active');
}

function hideLoading() {
  $('#loadingOverlay').classList.remove('active');
}

const STREAK_CARD_ID = '__crystal_streak__';

function loadStreak() {
  try {
    const data = localStorage.getItem('crystal_learning_streak');
    return data ? JSON.parse(data) : { count: 0, lastDate: null };
  } catch (e) {
    return { count: 0, lastDate: null };
  }
}

function saveStreak(streak, pushToNotion = true) {
  localStorage.setItem('crystal_learning_streak', JSON.stringify(streak));
  if (pushToNotion && getNotionProxyUrl()) {
    // Store streak as a hidden Database card so it syncs across devices
    const streakCard = {
      id: STREAK_CARD_ID,
      word: '__streak__',
      meaning: String(streak.count),
      example: streak.lastDate || '',
      pronunciation: '', category: '', audioUrl: '', lang: '',
      level: streak.count,
      nextReview: 0, createdAt: Date.now(), reviewCount: 0,
    };
    saveCardToNotion(streakCard); // fire-and-forget
  }
}

const HABITS_CARD_ID = '__crystal_habits__';
let habitPushTimer = null;

function markHabitsUpdated() {
  localStorage.setItem('crystal_habit_updated_at', String(Date.now()));
  pushHabitsToNotion();
}

function pushHabitsToNotion() {
  if (!getNotionProxyUrl()) return;
  clearTimeout(habitPushTimer);
  habitPushTimer = setTimeout(() => {
    // Store habit tracker data as a hidden Database card so it syncs across devices
    const habitsCard = {
      id: HABITS_CARD_ID,
      word: '__habits__',
      meaning: JSON.stringify({ habits, habitChecks, cardChecks }),
      example: localStorage.getItem('crystal_habit_updated_at') || String(Date.now()),
      pronunciation: '', category: '', audioUrl: '', lang: '',
      level: 0, nextReview: 0, createdAt: Date.now(), reviewCount: 0,
    };
    saveCardToNotion(habitsCard); // fire-and-forget
  }, 600);
}

// ── Language Filter System ──
const LANG_LABELS = {
  'en-US': 'English (美式)', 'en-GB': 'English (英式)',
  'ja-JP': '日本語', 'zh-TW': '練心',
  'ko-KR': '한국어', 'fr-FR': 'Français', 'de-DE': 'Deutsch',
  'es-ES': 'Español', 'th-TH': 'ภาษาไทย', 'vi-VN': 'Tiếng Việt',
};

// 將顯示名稱（或 BCP-47 代碼）轉回 BCP-47 代碼，自訂類別回傳 null
const DISPLAY_TO_LANG = {
  'English (美式)': 'en-US', 'English (英式)': 'en-GB',
  '日本語': 'ja-JP', '한국어': 'ko-KR', 'Français': 'fr-FR',
  'Deutsch': 'de-DE', 'Español': 'es-ES', 'Italiano': 'it-IT',
  'Português': 'pt-BR', 'ภาษาไทย': 'th-TH', 'Tiếng Việt': 'vi-VN',
  // 練心 intentionally omitted — no TTS
};

function getLangCode(lang) {
  if (!lang) return null;
  if (LANG_LABELS[lang]) return lang;       // already a BCP-47 code
  return DISPLAY_TO_LANG[lang] || null;     // display name → code, or null for custom
}

function getLangLabel(lang) {
  return LANG_LABELS[lang] || lang;
}

function getAvailableLangs() {
  const seen = new Set();
  cards.forEach(c => { if (c.lang) seen.add(getLangLabel(c.lang)); });
  return [...seen].sort();
}

function setLangFilter(lang) {
  currentLangFilter = lang;
  localStorage.setItem('crystal_lang_filter', lang);
  libraryShowAll = false;
  renderLangFilterBars();
  updateViewTitles();
  // Refresh all active views
  if ($('#dashboardView').classList.contains('active')) updateDashboard();
  if ($('#reviewView').classList.contains('active')) startReviewSession();
  if ($('#libraryView').classList.contains('active')) renderLibrary();
}

function updateViewTitles() {
  const langLabel = currentLangFilter === 'all' ? '所有語系' : getLangLabel(currentLangFilter);
  const dbTitle = $('#dashboardTitle');
  const rvTitle = $('#reviewTitle');
  const sparkSvg = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;position:relative;top:-2px;margin:0 2px"><path d="M12 2L13.5 9.5L21 12L13.5 14.5L12 22L10.5 14.5L3 12L10.5 9.5Z" stroke="var(--accent-primary)" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>`;
  const cardSvg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="vertical-align:middle;position:relative;top:-2px;margin:0 2px"><rect x="3" y="5" width="18" height="13" rx="2" stroke="var(--accent-primary)" stroke-width="1.8" fill="none"/><path d="M3 9h18" stroke="var(--accent-primary)" stroke-width="1.8"/></svg>`;
  if (dbTitle) dbTitle.innerHTML = `歡迎回來 ${sparkSvg} - ${langLabel}學習`;
  if (rvTitle) rvTitle.innerHTML = `複習卡片 ${cardSvg} - ${langLabel}`;
}

function renderLangFilterBars() {
  updateViewTitles();
  const containers = ['langFilterDashboard', 'langFilterReview', 'langFilterLibrary'];
  const langs = getAvailableLangs();
  const showBar = langs.length > 1;

  containers.forEach(id => {
    const el = $(`#${id}`);
    if (!el) return;

    if (!showBar) { el.style.display = 'none'; return; }
    el.style.display = 'flex';

    el.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'lang-btn' + (currentLangFilter === 'all' ? ' active' : '');
    allBtn.textContent = '全部';
    allBtn.addEventListener('click', () => setLangFilter('all'));
    el.appendChild(allBtn);

    langs.forEach(lang => {
      const btn = document.createElement('button');
      btn.className = 'lang-btn' + (currentLangFilter === lang ? ' active' : '');
      btn.textContent = getLangLabel(lang);
      btn.addEventListener('click', () => setLangFilter(lang));
      el.appendChild(btn);
    });
  });
}

function getCardsByLang() {
  // Always exclude hidden meta-cards (streak, habit tracker) from display lists
  const visible = cards.filter(c => c.id !== STREAK_CARD_ID && c.id !== HABITS_CARD_ID);
  if (currentLangFilter === 'all') return visible;
  return visible.filter(c => getLangLabel(c.lang) === currentLangFilter);
}

function initLangToggle() {
  // Deprecated toggle no longer used; renderLangFilterBars handles this now
}

// 讀取語言選單的有效值（處理「自訂類別...」的情況）
function getLangValue(id) {
  const sel = $(`#${id}`);
  if (!sel) return '';
  if (sel.tagName === 'SELECT' && sel.value === '__custom__') {
    return $(`#${id}Custom`)?.value.trim() || '';
  }
  return sel.value;
}

// 寫入語言選單（若為自訂值則自動切換到自訂輸入框）
function setLangValue(id, value) {
  const sel = $(`#${id}`);
  const custom = $(`#${id}Custom`);
  if (!sel || !value) return;
  const knownOpt = [...sel.options].find(o => o.value === value);
  if (knownOpt) {
    sel.value = value;
    if (custom) custom.style.display = 'none';
  } else {
    sel.value = '__custom__';
    if (custom) { custom.style.display = ''; custom.value = value; }
  }
  sel.dispatchEvent(new Event('change'));
}

// 取得所有已使用過的自訂類別（卡片 lang 值中不屬於內建選項者）
function getCustomCategories() {
  const sel = $('#inputLang');
  const builtin = new Set([...(sel?.options || [])].map(o => o.value));
  const seen = new Set();
  cards.forEach(c => {
    if (c.id === STREAK_CARD_ID || c.id === HABITS_CARD_ID) return;
    if (c.lang && !builtin.has(c.lang)) seen.add(c.lang);
  });
  return [...seen].sort();
}

// 為自訂類別輸入框加上模糊搜尋下拉建議
function attachCategoryAutocomplete(input, box) {
  if (!input || !box) return;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const cats = getCustomCategories().filter(c =>
      c.toLowerCase() !== q && (!q || c.toLowerCase().includes(q))
    );
    if (cats.length === 0) { box.style.display = 'none'; return; }
    box.innerHTML = cats.map(c =>
      `<div class="tag-suggestion-item" data-val="${escapeHtml(c)}">${escapeHtml(c)}</div>`
    ).join('');
    box.style.display = 'block';
    box.querySelectorAll('.tag-suggestion-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 避免 input 的 blur 先觸發
        input.value = el.dataset.val;
        input.dispatchEvent(new Event('input'));
        box.style.display = 'none';
      });
    });
  };
  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 200));
}

// 初始化語言選單的自訂輸入切換邏輯
function initLangSelectCustom(selectId) {
  const sel = $(`#${selectId}`);
  const custom = $(`#${selectId}Custom`);
  if (!sel || !custom) return;
  attachCategoryAutocomplete(custom, $(`#${selectId}CustomSuggestions`));
  sel.addEventListener('change', () => {
    const isCustom = sel.value === '__custom__';
    custom.style.display = isCustom ? '' : 'none';
    // 若是使用者手動點選「自訂類別...」（非程式設定），清空並聚焦
    if (isCustom && !custom.value) custom.focus();
    // 儲存語言偏好
    if (selectId === 'inputLang') {
      const val = getLangValue(selectId);
      if (val) localStorage.setItem('crystal_last_lang', val);
    }
  });
  custom.addEventListener('input', () => {
    if (selectId === 'inputLang') {
      const val = custom.value.trim();
      if (val) localStorage.setItem('crystal_last_lang', val);
    }
  });
}

function updateLanguageContextText() {
  initLangSelectCustom('inputLang');
  // Default add-card lang: restore from localStorage
  const lastLang = localStorage.getItem('crystal_last_lang');
  if (lastLang && $('#inputLang')) {
    setLangValue('inputLang', lastLang);
  }
}

// ── Text-to-Speech (TTS) ──
// Keep utterances globally to prevent aggressive Chrome Garbage Collection
window.__ttsUtterances = window.__ttsUtterances || [];

function speakText(text, lang = 'en-US', btnElement = null) {
  if (!text || !window.speechSynthesis) return;

  // Only cancel if something is actively playing. Calling cancel on an idle engine
  // sometimes causes the next speak() to be silently dropped in Chrome.
  const wasSpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
  if (wasSpeaking) window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  // Store reference to prevent GC
  window.__ttsUtterances.push(utterance);
  if (window.__ttsUtterances.length > 20) window.__ttsUtterances.shift();
  utterance.lang = lang;
  utterance.rate = 0.85;
  utterance.pitch = 1;
  utterance.volume = 1;

  // Try to find the best matching premium voice
  let voices = window.speechSynthesis.getVoices();

  if (voices.length === 0) {
    console.warn("[TTS] Voices empty on first call, retrying asynchronously...");
  }

  const baseLang = lang.split('-')[0].toLowerCase();

  let availableVoices = voices.filter(v =>
    v.lang.toLowerCase() === lang.toLowerCase() ||
    v.lang.toLowerCase().startsWith(baseLang)
  );

  if (availableVoices.length > 0) {
    // Score voices by quality heuristic
    const getScore = (v) => {
      let score = 0;
      const name = v.name.toLowerCase();
      // Highest priority to known neural/high-quality engines
      if (name.includes('premium')) score += 10;
      if (name.includes('enhanced')) score += 9;
      if (name.includes('microsoft')) score += 8;
      if (name.includes('google')) score += 7;
      if (name.includes('siri')) score += 6;

      // Exact locale match gets a boost
      if (v.lang.toLowerCase() === lang.toLowerCase()) score += 3;
      // Default voice fallback
      if (v.default) score += 1;
      return score;
    };

    availableVoices.sort((a, b) => getScore(b) - getScore(a));
    utterance.voice = availableVoices[0];
    console.log("Selected TTS Voice:", utterance.voice.name);
  } else {
    console.warn("No TTS voice found for language:", lang);
  }

  // Animate button
  if (btnElement) {
    btnElement.classList.add('speaking');
    let stopped = false;
    const stopAnimation = () => {
      if (stopped) return;
      stopped = true;
      btnElement.classList.remove('speaking');
    };
    utterance.onend = stopAnimation;
    utterance.onerror = (e) => {
      // Chrome sometimes fires 'canceled' falsely during start or immediately after cancel
      if (e.error !== 'canceled') {
        console.error("[TTS] Playback Error:", e);
      }
      stopAnimation();
    };

    // iOS 若在非使用者手勢中呼叫 speak() 會被靜默擋掉，onend / onerror 都不會來，
    // 沒有這個看門狗按鈕會一直閃下去
    const watchdog = setInterval(() => {
      if (stopped) { clearInterval(watchdog); return; }
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        clearInterval(watchdog);
        stopAnimation();
      }
    }, 1000);
  }

  // Play: use a delay if we had to cancel first, otherwise play immediately
  const delay = wasSpeaking ? 200 : 0;
  setTimeout(() => {
    // Safari/iOS 的引擎偶爾會卡在 paused，不 resume 的話 speak() 進去就沒下文
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
    console.log(`[TTS] Speaking: "${text}"`);
  }, delay);
}

// Preload voices (some browsers load them async)
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// ── UUID Generator ──
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ── Date Helpers ──
function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  return `${months[date.getMonth()]}${date.getDate()}日`;
}

function daysDiff(from, to) {
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

function addDays(timestamp, days) {
  return timestamp + days * 24 * 60 * 60 * 1000;
}

function getRelativeDay(timestamp) {
  const today = getToday();
  const diff = daysDiff(today, timestamp);
  if (diff < 0) return '已逾期';
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '後天';
  return `${diff} 天後`;
}

// ── Background Particles ──
function initParticles() {
  const container = $('#bgParticles');
  const colors = [
    'rgba(99, 102, 241, 0.3)',
    'rgba(168, 85, 247, 0.25)',
    'rgba(236, 72, 153, 0.2)',
    'rgba(59, 130, 246, 0.25)',
  ];

  for (let i = 0; i < 15; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    const size = Math.random() * 4 + 2;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.background = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDuration = `${Math.random() * 15 + 10}s`;
    particle.style.animationDelay = `${Math.random() * 10}s`;
    container.appendChild(particle);
  }
}

// ── Navigation ──
function initNavigation() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  // 點擊左上角 logo/標題區塊回到預設首頁（知識庫）
  $('.nav-brand').addEventListener('click', () => switchView('library'));

  // 點 logo 圖示＝主動從資料庫拉最新資料（H5 加到主畫面沒有重新整理鈕）
  $('.brand-icon').addEventListener('click', (e) => {
    e.stopPropagation(); // 不要冒泡上去觸發 .nav-brand 的切頁
    refreshFromCloud();
  });

  // Quick actions
  $('#quickReview').addEventListener('click', () => switchView('review'));
  $('#quickAdd').addEventListener('click', () => switchView('add'));
  $('#emptyAddBtn').addEventListener('click', () => switchView('add'));
  $('#backToDashboard').addEventListener('click', () => switchView('dashboard'));
}

function switchView(viewName) {
  if (!viewName) return;
  // Update nav
  $$('.nav-btn').forEach(btn => {
    if (btn.dataset.view) {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    }
  });

  // Update views
  $$('.view').forEach(v => v.classList.remove('active'));
  const targetView = $(`#${viewName}View`);
  if (targetView) {
    targetView.classList.add('active');
  }

  // Trigger view-specific updates
  if (viewName === 'dashboard') updateDashboard();
  if (viewName === 'review') startReviewSession();
  if (viewName === 'library') renderLibrary();
  if (viewName === 'habit') renderHabitTracker({ anchorToday: true });
}

// ── Date Display ──
function updateDateDisplay() {
  const now = new Date();
  const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  $('#dateDisplay').textContent = `${now.getFullYear()}年 ${months[now.getMonth()]}${now.getDate()}日 ${weekdays[now.getDay()]}`;
}

// ── Dashboard ──
function updateDashboard() {
  const activeCards = getCardsByLang();
  const today = getToday();
  const dueCards = activeCards.filter(c => c.nextReview <= today);
  const masteredCards = activeCards.filter(c => c.level >= 5);

  // Update stats
  $('#statTotal').textContent = activeCards.length;
  $('#statDue').textContent = dueCards.length;
  $('#statMastered').textContent = masteredCards.length;

  // Streak
  const streak = loadStreak();
  const todayStr = new Date().toDateString();
  $('#statStreak').textContent = streak.count;

  // Review count label
  if (dueCards.length > 0) {
    $('#reviewCountLabel').textContent = `有 ${dueCards.length} 張卡片待複習`;
  } else {
    $('#reviewCountLabel').textContent = '太棒了！沒有待複習的卡片';
  }

  // Schedule timeline
  renderSchedule(activeCards);
}


function renderSchedule(filteredCards) {
  const timeline = $('#scheduleTimeline');
  const today = getToday();

  if (!filteredCards || filteredCards.length === 0) {
    timeline.innerHTML = `
      <div class="empty-state small">
        <p>尚無排程，請先新增字句！</p>
      </div>`;
    return;
  }

  // Group cards by review date
  const groups = {};
  filteredCards.forEach(card => {
    const reviewDate = new Date(card.nextReview);
    const dateKey = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate()).getTime();
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(card);
  });

  // Sort and display the next 7 groups
  const sortedDates = Object.keys(groups).map(Number).sort((a, b) => a - b).slice(0, 7);

  if (sortedDates.length === 0) {
    timeline.innerHTML = `
      <div class="empty-state small">
        <p>尚無排程</p>
      </div>`;
    return;
  }

  timeline.innerHTML = sortedDates.map(dateKey => {
    const count = groups[dateKey].length;
    const diff = daysDiff(today, dateKey);
    let countClass = 'later';
    if (diff <= 0) countClass = 'today';
    else if (diff === 1) countClass = 'tomorrow';

    const relative = getRelativeDay(dateKey);
    const dateStr = formatDate(dateKey);
    const words = groups[dateKey].slice(0, 3).map(c => c.word).join('、');
    const extra = count > 3 ? `⋯等 ${count} 個` : '';

    return `
      <div class="schedule-day">
        <span class="schedule-date">${relative}</span>
        <span class="schedule-count ${countClass}">${count}</span>
        <span class="schedule-label">${dateStr} — ${words}${extra}</span>
      </div>`;
  }).join('');
}

// ── Habit Tracker ──
function habitDateKey(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 欄位範圍：從最早紀錄月份（最多回溯 HABIT_MAX_MONTHS_BACK 個月）到本月月底。
// 每次渲染都以「今天」重新計算月底，因此每個月 1 日一到，新的一個月欄位就會自動出現，不需要額外排程。
function buildTrackerColumns(earliestTs) {
  const today = getToday();
  const todayD = new Date(today);
  const earliestD = new Date(Math.min(earliestTs, today));
  const startCandidate = new Date(earliestD.getFullYear(), earliestD.getMonth(), 1).getTime();
  const capStartMonth = new Date(todayD.getFullYear(), todayD.getMonth() - HABIT_MAX_MONTHS_BACK, 1).getTime();
  const startMonth = Math.max(startCandidate, capStartMonth);
  const endMonth = new Date(todayD.getFullYear(), todayD.getMonth() + 1, 0).getTime();

  const cols = [];
  let cur = startMonth;
  while (cur <= endMonth) {
    cols.push(cur);
    cur = addDays(cur, 1);
  }
  return cols;
}

function getHabitDateColumns() {
  let earliest = getToday();
  habits.forEach(h => {
    const c = new Date(h.createdAt);
    const t = new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime();
    if (t < earliest) earliest = t;
  });
  return buildTrackerColumns(earliest);
}

function isHabitChecked(habitId, dateKey) {
  return !!(habitChecks[habitId] && habitChecks[habitId][dateKey]);
}

function isCardChecked(cardId, dateKey) {
  return !!(cardChecks[cardId] && cardChecks[cardId][dateKey]);
}

// 本月最高連續打卡天數：只看當月 1 日到月底，下個月重新計算會自動歸 0。
// isCheckedFn(dateKey) 回傳該日是否打卡，供習慣與卡片共用。
function currentMonthMaxStreak(isCheckedFn) {
  const today = new Date(getToday());
  const y = today.getFullYear();
  const m = today.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  let maxStreak = 0;
  let cur = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const key = habitDateKey(new Date(y, m, day).getTime());
    if (isCheckedFn(key)) {
      cur++;
      if (cur > maxStreak) maxStreak = cur;
    } else {
      cur = 0;
    }
  }
  return maxStreak;
}

function getCurrentMonthMaxStreak(habitId) {
  return currentMonthMaxStreak(key => isHabitChecked(habitId, key));
}

function addHabit(name) {
  name = (name || '').trim();
  if (!name) return;
  habits.push({
    id: 'habit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name,
    createdAt: Date.now(),
  });
  saveHabitsToLocal();
  markHabitsUpdated();
  renderHabitTracker();
}

function deleteHabit(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  if (!confirm(`確定要刪除習慣「${h.name}」嗎？此操作無法復原。`)) return;
  habits = habits.filter(x => x.id !== id);
  delete habitChecks[id];
  saveHabitsToLocal();
  saveHabitChecksToLocal();
  markHabitsUpdated();
  renderHabitTracker();
}

function renameHabit(id, newName) {
  const habit = habits.find(h => h.id === id);
  if (!habit) return;
  const name = (newName || '').trim();
  if (!name || name === habit.name) { renderHabitTracker(); return; }
  habit.name = name;
  saveHabitsToLocal();
  markHabitsUpdated();
  renderHabitTracker();
}

// 就地編輯習慣名稱：將名稱文字換成輸入框，Enter/失焦儲存，Esc 取消
function startHabitRename(id, spanEl) {
  const habit = habits.find(h => h.id === id);
  if (!habit || !spanEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'habit-name-edit-input';
  input.value = habit.name;
  spanEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    if (save) renameHabit(id, input.value);
    else renderHabitTracker();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

function toggleHabitCheck(habitId, dateKey) {
  if (!habitChecks[habitId]) habitChecks[habitId] = {};
  if (habitChecks[habitId][dateKey]) delete habitChecks[habitId][dateKey];
  else habitChecks[habitId][dateKey] = true;
  saveHabitChecksToLocal();
  markHabitsUpdated();
  renderHabitTracker();
}

// ── 知識庫卡片打卡 ──
function todayKey() {
  return habitDateKey(getToday());
}

// 該類別(lang 顯示名稱)今日是否還有其他卡片被打卡
function isLangCheckedTodayByOther(langLabel, exceptCardId, key) {
  return cards.some(c =>
    c.id !== exceptCardId &&
    c.id !== STREAK_CARD_ID && c.id !== HABITS_CARD_ID &&
    getLangLabel(c.lang) === langLabel &&
    isCardChecked(c.id, key)
  );
}

// 依卡片 lang 連動習慣追蹤：打卡→建立/補打習慣今日；智慧取消→無其他同類別卡片時取消習慣今日
function syncLangHabitFromCard(card, isNowChecked, key) {
  const langLabel = getLangLabel(card.lang);
  if (!langLabel) return;
  let habit = habits.find(h => h.name === langLabel);

  if (isNowChecked) {
    if (!habit) {
      habit = {
        id: 'habit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: langLabel,
        createdAt: Date.now(),
      };
      habits.push(habit);
      saveHabitsToLocal();
    }
    if (!habitChecks[habit.id]) habitChecks[habit.id] = {};
    habitChecks[habit.id][key] = true;
    saveHabitChecksToLocal();
  } else {
    // 智慧取消：該類別今日已無任何其他卡片打卡才取消習慣今日打卡
    if (habit && habitChecks[habit.id] && habitChecks[habit.id][key] &&
        !isLangCheckedTodayByOther(langLabel, card.id, key)) {
      delete habitChecks[habit.id][key];
      saveHabitChecksToLocal();
    }
  }
}

function toggleCardCheck(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  const key = todayKey();
  if (!cardChecks[cardId]) cardChecks[cardId] = {};
  const isNowChecked = !cardChecks[cardId][key];
  if (isNowChecked) cardChecks[cardId][key] = true;
  else delete cardChecks[cardId][key];
  saveCardChecksToLocal();

  syncLangHabitFromCard(card, isNowChecked, key);

  markHabitsUpdated();
  if ($('#habitView')?.classList.contains('active')) renderHabitTracker();
}

// 回傳是否真的捲成功。頁面還隱藏著（.view 沒有 active）時整張表量不到位置，
// offsetLeft 全是 0、scrollLeft 也吃不進去，這種情況要回報失敗讓呼叫端之後再試一次
function scrollHabitTrackerToToday() {
  const container = $('#habitTrackerScroll');
  const table = $('#habitTrackerTable');
  if (!container || !table) return false;
  if (!container.clientWidth) return false;
  const todayCell = table.querySelector('.habit-day-col.is-today');
  const nameCol = table.querySelector('.habit-name-col');
  if (!todayCell) {
    container.scrollLeft = container.scrollWidth;
    return true;
  }
  const nameWidth = nameCol ? nameCol.offsetWidth : 0;
  container.scrollLeft = Math.max(0, todayCell.offsetLeft - nameWidth);
  return true;
}

// 渲染打卡表的月份列與日期列（習慣追蹤與卡片打卡紀錄共用）
function renderTrackerHead(monthRow, dayRow, cols, today, nameLabel) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  // Month header row (colspan per month group)
  let monthHtml = '<th class="habit-name-col"></th>';
  let i = 0;
  while (i < cols.length) {
    const d = new Date(cols[i]);
    const y = d.getFullYear();
    const m = d.getMonth();
    let span = 0;
    while (i + span < cols.length) {
      const dd = new Date(cols[i + span]);
      if (dd.getFullYear() !== y || dd.getMonth() !== m) break;
      span++;
    }
    monthHtml += `<th class="habit-month-col" colspan="${span}">${y}年${m + 1}月</th>`;
    i += span;
  }
  monthHtml += '<th class="habit-streak-col"></th>';
  monthRow.innerHTML = monthHtml;

  // Day number header row
  let dayHtml = `<th class="habit-name-col">${escapeHtml(nameLabel)}</th>`;
  cols.forEach(ts => {
    const d = new Date(ts);
    const isToday = ts === today;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const cls = ['habit-day-col'];
    if (isToday) cls.push('is-today');
    if (isWeekend) cls.push('is-weekend');
    dayHtml += `<th class="${cls.join(' ')}" title="${weekdays[d.getDay()]}">${d.getDate()}</th>`;
  });
  dayHtml += '<th class="habit-streak-col">最高連續</th>';
  dayRow.innerHTML = dayHtml;
}

// 卡片打卡紀錄 Modal（唯讀，格式同習慣追蹤）
function openCardRecordModal(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  const modal = $('#cardRecordModal');
  const titleEl = $('#cardRecordTitle');
  const monthRow = $('#cardRecordMonthRow');
  const dayRow = $('#cardRecordDayRow');
  const body = $('#cardRecordBody');
  const scroll = $('#cardRecordScroll');
  if (!modal || !monthRow || !dayRow || !body) return;

  titleEl.textContent = `${card.word} · 打卡紀錄`;

  const cardStart = new Date(card.createdAt);
  const earliest = new Date(cardStart.getFullYear(), cardStart.getMonth(), cardStart.getDate()).getTime();
  const cols = buildTrackerColumns(earliest);
  const today = getToday();

  renderTrackerHead(monthRow, dayRow, cols, today, '生字');

  const cellsHtml = cols.map((ts, idx) => {
    const key = habitDateKey(ts);
    const checked = isCardChecked(cardId, key);
    const prevChecked = idx > 0 && isCardChecked(cardId, habitDateKey(cols[idx - 1]));
    const nextChecked = idx < cols.length - 1 && isCardChecked(cardId, habitDateKey(cols[idx + 1]));
    const cls = ['habit-check-cell', 'readonly'];
    if (checked) cls.push('checked');
    if (checked && prevChecked) cls.push('connect-prev');
    if (checked && nextChecked) cls.push('connect-next');
    return `<td><span class="${cls.join(' ')}"><span class="habit-check-dot"></span></span></td>`;
  }).join('');
  const maxStreak = currentMonthMaxStreak(key => isCardChecked(cardId, key));
  body.innerHTML = `<tr>
    <td class="habit-name-col"><div class="habit-name-cell"><span class="habit-name-text" title="${escapeHtml(card.word)}">${escapeHtml(card.word)}</span></div></td>
    ${cellsHtml}
    <td class="habit-streak-col"><span class="habit-streak-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>${maxStreak}</span></td>
  </tr>`;

  modal.classList.add('active');
  // 捲動到今天、為被截斷的名稱補上 tooltip（需在 Modal 顯示後量測）
  requestAnimationFrame(() => {
    const todayCell = $('#cardRecordTable')?.querySelector('.habit-day-col.is-today');
    const nameCol = $('#cardRecordTable')?.querySelector('.habit-name-col');
    if (scroll) {
      if (todayCell) scroll.scrollLeft = Math.max(0, todayCell.offsetLeft - (nameCol ? nameCol.offsetWidth : 0));
      else scroll.scrollLeft = scroll.scrollWidth;
    }
    applyEllipsisTitles(body);
  });
}

// title 預設已在模板寫入（完整名稱），確保任何 render/隱藏狀態下截斷項目「一定」有 tooltip。
// 這裡只在「可見且未截斷」時把多餘的 title 移除，讓短名稱不顯示 tooltip。
// 隱藏（clientWidth 為 0）時完全不動，避免量測失準誤刪 title，造成 tooltip 閃一下就消失。
function applyEllipsisTitles(scope) {
  if (!scope) return;
  scope.querySelectorAll('.habit-name-text').forEach(el => {
    if (el.clientWidth === 0) return;                    // 隱藏，維持模板 title 不動
    if (el.scrollWidth > el.clientWidth + 1) {
      el.setAttribute('title', el.textContent);          // 截斷：確保 title 為完整內容
    } else {
      el.removeAttribute('title');                       // 未截斷：短名稱不需 tooltip
    }
  });
}

// anchorToday：切進習慣追蹤頁時強制定錨回今天；其餘情況（打卡、背景同步重繪）保留使用者原本捲到的位置
function renderHabitTracker({ anchorToday = false } = {}) {
  const monthRow = $('#habitMonthRow');
  const dayRow = $('#habitDayRow');
  const body = $('#habitTrackerBody');
  const container = $('#habitTrackerScroll');
  const emptyState = $('#emptyHabit');
  if (!monthRow || !dayRow || !body) return;

  emptyState.style.display = habits.length === 0 ? '' : 'none';
  container.style.display = habits.length === 0 ? 'none' : '';
  if (habits.length === 0) {
    monthRow.innerHTML = '';
    dayRow.innerHTML = '';
    body.innerHTML = '';
    return;
  }

  const prevScrollLeft = container.scrollLeft;
  const cols = getHabitDateColumns();
  const today = getToday();

  renderTrackerHead(monthRow, dayRow, cols, today, '習慣');

  // Habit rows
  body.innerHTML = habits.map(h => {
    const cellsHtml = cols.map((ts, idx) => {
      const key = habitDateKey(ts);
      const checked = isHabitChecked(h.id, key);
      const prevChecked = idx > 0 && isHabitChecked(h.id, habitDateKey(cols[idx - 1]));
      const nextChecked = idx < cols.length - 1 && isHabitChecked(h.id, habitDateKey(cols[idx + 1]));
      const cls = ['habit-check-cell'];
      if (checked) cls.push('checked');
      if (checked && prevChecked) cls.push('connect-prev');
      if (checked && nextChecked) cls.push('connect-next');
      return `<td><button type="button" class="${cls.join(' ')}" data-habit-id="${h.id}" data-date="${key}" aria-label="${h.name} ${key}"><span class="habit-check-dot"></span></button></td>`;
    }).join('');
    const maxStreak = getCurrentMonthMaxStreak(h.id);
    return `<tr data-habit-id="${h.id}">
      <td class="habit-name-col">
        <div class="habit-name-cell">
          <span class="habit-name-text" data-habit-id="${h.id}" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</span>
          <div class="habit-name-actions">
            <button type="button" class="habit-edit-btn" data-habit-id="${h.id}" title="編輯名稱">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button type="button" class="habit-delete-btn" data-habit-id="${h.id}" title="刪除習慣">×</button>
          </div>
        </div>
      </td>
      ${cellsHtml}
      <td class="habit-streak-col"><span class="habit-streak-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>${maxStreak}</span></td>
    </tr>`;
  }).join('');

  if (anchorToday || !habitScrollInitialized) {
    // 讀 clientWidth／offsetLeft 會強制 reflow，切進本頁時同步呼叫就量得到，多數情況這裡就成功；
    // 真的量不到（頁面還隱藏著）再等下一幀補一次。不能只靠 rAF——分頁在背景時它根本不會觸發
    if (scrollHabitTrackerToToday()) {
      habitScrollInitialized = true;
    } else {
      requestAnimationFrame(() => {
        if (scrollHabitTrackerToToday()) habitScrollInitialized = true;
      });
    }
  } else {
    container.scrollLeft = prevScrollLeft;
  }

  applyEllipsisTitles(body);
}

function initHabitDragScroll(container) {
  let isDown = false;
  let startX = 0;
  let scrollStart = 0;
  let moved = false;

  container.addEventListener('mousedown', (e) => {
    isDown = true;
    moved = false;
    startX = e.pageX;
    scrollStart = container.scrollLeft;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    const dx = e.pageX - startX;
    if (Math.abs(dx) > 4) {
      moved = true;
      container.classList.add('dragging');
    }
    if (moved) container.scrollLeft = scrollStart - dx;
  });

  window.addEventListener('mouseup', () => {
    isDown = false;
    container.classList.remove('dragging');
    setTimeout(() => { moved = false; }, 0);
  });

  container.addEventListener('click', (e) => {
    if (moved) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}

function initHabitTracker() {
  const input = $('#newHabitInput');
  $('#addHabitBtn').addEventListener('click', () => {
    addHabit(input.value);
    input.value = '';
    input.focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addHabit(input.value);
      input.value = '';
    }
  });

  const body = $('#habitTrackerBody');
  body.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.habit-edit-btn');
    if (editBtn) {
      const nameEl = editBtn.closest('.habit-name-cell')?.querySelector('.habit-name-text');
      startHabitRename(editBtn.dataset.habitId, nameEl);
      return;
    }
    const deleteBtn = e.target.closest('.habit-delete-btn');
    if (deleteBtn) {
      deleteHabit(deleteBtn.dataset.habitId);
      return;
    }
    const checkCell = e.target.closest('.habit-check-cell');
    if (checkCell) {
      toggleHabitCheck(checkCell.dataset.habitId, checkCell.dataset.date);
    }
  });
  // 雙擊名稱也可編輯
  body.addEventListener('dblclick', (e) => {
    const nameEl = e.target.closest('.habit-name-text');
    if (nameEl) startHabitRename(nameEl.dataset.habitId, nameEl);
  });

  initHabitDragScroll($('#habitTrackerScroll'));
}

// ── Add Form ──
function initAddForm() {
  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    // 送出中就擋掉：按鈕雖然已 disabled，但在輸入框按 Enter 仍可能觸發 submit
    if (_isAddingCard) return;

    // Flush any lingering tag text before saving
    if ($('#addTagInput') && $('#addTagInput').value.trim()) {
      const text = $('#addTagInput').value.trim();
      const tags = $('#inputCategory').value ? $('#inputCategory').value.split(',') : [];
      if (!tags.includes(text)) tags.push(text);
      $('#inputCategory').value = tags.filter(Boolean).join(',');
      $('#addTagInput').value = '';
      _addTagInput?.renderChips();
    }

    const word = $('#inputWord').value.trim();
    const pronunciation = $('#inputPronunciation').value.trim();
    const meaning = $('#inputMeaning').value.trim();
    const example = $('#inputExample').value.trim();
    const category = $('#inputCategory').value.trim();
    const audioUrl = $('#inputAudioUrl').value.trim();
    const lang = getLangValue('inputLang');
    const imageUrl = _addImageUrl || '';

    if (!word) return;
    if (!meaning && !imageUrl) {
      showToast('請輸入翻譯，或上傳圖片');
      return;
    }

    const newCard = {
      id: generateId(),
      word,
      pronunciation,
      meaning,
      example,
      category,
      audioUrl,
      imageUrl,
      lang,
      level: 0,
      nextReview: getToday(),
      createdAt: Date.now(),
      reviewCount: 0,
    };
    cards.push(newCard);
    saveCardsToLocal();

    // 存雲端成功才清表單。之前是先清再送，一旦上傳失敗使用者剛打的內容就沒了，只能整張重打
    setAddFormBusy(true);

    // Decouple network request from form submit lifecycle to prevent iOS Safari cancellation
    setTimeout(async () => {
      const ok = await saveCardToNotion(newCard, { silent: true });
      setAddFormBusy(false);

      if (!ok) {
        // 把剛剛樂觀寫入的本地卡片撤掉：表單內容還在，使用者重按就好，不會變成兩張
        // （本地留著也沒用，下次開 App 同步時會被雲端整包覆寫掉）
        cards = cards.filter(c => c.id !== newCard.id);
        saveCardsToLocal();
        showToast('儲存失敗，內容已保留，請確認連線後再送出一次');
        return;
      }

      clearAddForm();
      updateCategoryDatalist();
      showToast(`「${word}」已成功加入知識庫！`);
    }, 100);
  });
}

// 送出期間鎖住按鈕，避免使用者以為沒反應而重複點擊送出兩張
function setAddFormBusy(busy) {
  _isAddingCard = busy;
  const btn = $('#submitBtn');
  if (!btn) return;
  btn.disabled = busy;
  const label = $('#submitBtnText');
  if (label) label.textContent = busy ? '儲存中...' : '加入知識庫';
}

function clearAddForm() {
  $('#addForm').reset();
  // Restore last-used language (form reset reverts to HTML default)
  const lastLang = localStorage.getItem('crystal_last_lang');
  if (lastLang && $('#inputLang')) {
    setLangValue('inputLang', lastLang);
  }
  // Also clear status texts
  const addStatus = $('#addAudioStatus');
  if (addStatus) { addStatus.style.display = 'none'; addStatus.textContent = ''; }

  const translateStatus = $('#translateStatus');
  if (translateStatus) { translateStatus.style.display = 'none'; translateStatus.textContent = ''; }
  const imgStatus = $('#meaningImageStatus');
  if (imgStatus) { imgStatus.style.display = 'none'; imgStatus.textContent = ''; }
  _addImageUrl = '';
  _addTagInput?.setTags('');
  $('#inputWord').focus();
}

function showToast(message) {
  const toast = $('#successToast');
  $('#toastMessage').textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Review System ──
function initReview() {
  // Flashcard flip
  $('#flashcard').addEventListener('click', () => {
    const card = $('#flashcard');
    card.classList.toggle('flipped');

    // Show rating when flipped
    if (card.classList.contains('flipped')) {
      setTimeout(() => {
        $('#ratingContainer').classList.add('visible');
      }, 300);
    } else {
      $('#ratingContainer').classList.remove('visible');
    }
  });

  // Speak buttons on flashcard
  $('#frontSpeakBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Don't flip the card
    if (currentReviewIndex < reviewQueue.length) {
      const card = reviewQueue[currentReviewIndex];
      const mode = $('#reviewModeSelect').value;
      if (mode === 'word-first') {
        playOrSpeak(card, card.word, card.lang || 'en-US', e.currentTarget);
      } else {
        speakText(card.meaning, 'zh-TW', e.currentTarget);
      }
    }
  });

  $('#backSpeakBtn').addEventListener('click', (e) => {
    e.stopPropagation(); // Don't flip the card
    if (currentReviewIndex < reviewQueue.length) {
      const card = reviewQueue[currentReviewIndex];
      const mode = $('#reviewModeSelect').value;
      if (mode === 'word-first') {
        speakText(card.meaning, 'zh-TW', e.currentTarget);
      } else {
        playOrSpeak(card, card.word, card.lang || 'en-US', e.currentTarget);
      }
    }
  });

  // Handle Review Mode switch mid-review
  $('#reviewModeSelect').addEventListener('change', () => {
    if ($('#reviewView').classList.contains('active') && reviewQueue.length > 0 && currentReviewIndex < reviewQueue.length) {
      showCurrentCard();
    }
  });

  // Rating buttons
  $$('.rating-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rating = parseInt(btn.dataset.rating);
      handleRating(rating);
    });
  });
}

function startReviewSession() {
  const today = getToday();
  const activeCards = getCardsByLang();
  reviewQueue = activeCards.filter(c => c.nextReview <= today);
  currentReviewIndex = 0;
  reviewStats = { total: reviewQueue.length, correct: 0, wrong: 0 };

  // Reset UI
  $('#reviewComplete').style.display = 'none';
  $('#flashcardContainer').style.display = 'none';
  $('#emptyReview').style.display = 'none';

  if (reviewQueue.length === 0) {
    $('#emptyReview').style.display = 'flex';
    $('#reviewProgressText').textContent = '0 / 0';
    $('#reviewProgressFill').style.width = '0%';
    $('#reviewSubtitle').textContent = '目前沒有待複習的卡片';
    return;
  }

  // Shuffle review queue
  shuffleArray(reviewQueue);

  $('#flashcardContainer').style.display = 'flex';
  $('#reviewSubtitle').textContent = '翻轉卡片查看答案';
  showCurrentCard();
}

function showCurrentCard() {
  if (currentReviewIndex >= reviewQueue.length) {
    finishReview();
    return;
  }

  const card = reviewQueue[currentReviewIndex];

  // Update progress
  $('#reviewProgressText').textContent = `${currentReviewIndex + 1} / ${reviewQueue.length}`;
  const progress = ((currentReviewIndex) / reviewQueue.length) * 100;
  $('#reviewProgressFill').style.width = `${progress}%`;

  // Reset flip state
  $('#flashcard').classList.remove('flipped');
  $('#ratingContainer').classList.remove('visible');

  // Set card content general items
  const levelNames = ['新學', '初學', '學習中', '熟悉中', '進階', '精通', '大師'];
  $('#cardLevelBadge').textContent = `Level ${card.level} — ${levelNames[Math.min(card.level, 6)]}`;
  $('#cardLevelBadgeBack').textContent = `Level ${card.level}`;
  $('#cardCategory').textContent = card.category || '';

  const mode = $('#reviewModeSelect').value;

  if (mode === 'word-first') {
    // Front shows the Word
    $('#frontPrimaryText').className = 'card-word';
    $('#frontPrimaryText').textContent = card.word;
    $('#frontSecondaryText').textContent = card.pronunciation || '';
    $('#frontSecondaryText').style.display = card.pronunciation ? 'block' : 'none';

    // Back shows Meaning and Example
    $('#backPrimaryText').className = 'card-meaning';
    $('#backPrimaryText').textContent = card.meaning;
    $('#backSecondaryText').style.display = 'none'; // No pronunciation on back by default
    $('#backTertiaryText').textContent = card.example || '';
    $('#backTertiaryText').style.display = card.example ? 'block' : 'none';
    $('#backTertiaryText').scrollTop = 0;

  } else {
    // Front shows Meaning (Quiz mode)
    $('#frontPrimaryText').className = 'card-meaning';
    $('#frontPrimaryText').textContent = card.meaning;
    $('#frontSecondaryText').style.display = 'none';

    // Back shows Word, Pronunciation, Example
    $('#backPrimaryText').className = 'card-word';
    $('#backPrimaryText').textContent = card.word;

    $('#backSecondaryText').textContent = card.pronunciation || '';
    $('#backSecondaryText').style.display = card.pronunciation ? 'block' : 'none';

    $('#backTertiaryText').textContent = card.example || '';
    $('#backTertiaryText').style.display = card.example ? 'block' : 'none';
    $('#backTertiaryText').scrollTop = 0;
  }

  // Update schedule hints
  updateScheduleHints(card);

  // Show card image if present
  const cardImg = $('#cardImage');
  const cardImgFront = $('#cardImageFront');
  if (cardImg || cardImgFront) {
    if (card.imageUrl) {
      // Convert Google Drive share URL to direct embed URL
      const driveMatch = card.imageUrl.match(/\/file\/d\/([^/]+)/);
      const embedUrl = driveMatch
        ? `https://lh3.googleusercontent.com/d/${driveMatch[1]}`
        : card.imageUrl;
      if (cardImg) {
        cardImg.src = embedUrl;
        cardImg.style.display = 'block';
      }
      if (cardImgFront) {
        cardImgFront.src = embedUrl;
        cardImgFront.style.display = 'block';
      }
    } else {
      if (cardImg) {
        cardImg.style.display = 'none';
        cardImg.src = '';
      }
      if (cardImgFront) {
        cardImgFront.style.display = 'none';
        cardImgFront.src = '';
      }
    }
  }
}

function updateScheduleHints(card) {
  // Forgot: reset to level 0
  const forgotDays = INTERVALS[0];
  $('#schedForgot').textContent = `重置 → 今天`;

  // Hard: stay same level
  const hardDays = INTERVALS[Math.min(card.level, INTERVALS.length - 1)];
  $('#schedHard').textContent = hardDays === 0 ? '今天再複習' : `${hardDays} 天後`;

  // Good: advance 1 level
  const goodLevel = Math.min(card.level + 1, INTERVALS.length - 1);
  const goodDays = INTERVALS[goodLevel];
  $('#schedGood').textContent = `${goodDays} 天後`;

  // Easy: advance 2 levels
  const easyLevel = Math.min(card.level + 2, INTERVALS.length - 1);
  const easyDays = INTERVALS[easyLevel];
  $('#schedEasy').textContent = `${easyDays} 天後`;
}

function handleRating(rating) {
  const card = reviewQueue[currentReviewIndex];
  const originalCard = cards.find(c => c.id === card.id);

  if (!originalCard) return;

  const today = getToday();

  switch (rating) {
    case 0: // Forgot
      originalCard.level = 0;
      originalCard.nextReview = today;
      reviewStats.wrong++;
      break;
    case 1: // Hard - stay same level
      originalCard.nextReview = addDays(today, INTERVALS[Math.min(originalCard.level, INTERVALS.length - 1)]);
      reviewStats.wrong++;
      break;
    case 2: // Good - advance 1 level
      originalCard.level = Math.min(originalCard.level + 1, INTERVALS.length - 1);
      originalCard.nextReview = addDays(today, INTERVALS[originalCard.level]);
      reviewStats.correct++;
      break;
    case 3: // Easy - advance 2 levels
      originalCard.level = Math.min(originalCard.level + 2, INTERVALS.length - 1);
      originalCard.nextReview = addDays(today, INTERVALS[originalCard.level]);
      reviewStats.correct++;
      break;
  }

  originalCard.reviewCount++;
  saveCardsToLocal();

  // Sync to Database in background
  saveCardToNotion(originalCard);

  // Animate to next card
  currentReviewIndex++;

  // Small delay for user feedback
  setTimeout(() => {
    showCurrentCard();
  }, 300);
}

function finishReview() {
  // Update streak — use UTC date so all timezones agree on the same date string
  const streak = loadStreak();
  const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" UTC
  if (streak.lastDate !== todayStr) {
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (streak.lastDate === yesterdayStr) {
      streak.count++;
    } else {
      streak.count = 1;
    }
    streak.lastDate = todayStr;
    saveStreak(streak);
  }

  // Show completion
  $('#flashcardContainer').style.display = 'none';
  $('#reviewComplete').style.display = 'flex';
  $('#reviewProgressFill').style.width = '100%';

  $('#completeTotal').textContent = reviewStats.total;
  $('#completeCorrect').textContent = reviewStats.correct;
  $('#completeWrong').textContent = reviewStats.wrong;

  // Animate numbers
  $$('.complete-stat-num').forEach(el => {
    const target = parseInt(el.textContent);
    el.textContent = '0';
    let current = 0;
    const increment = Math.max(1, Math.ceil(target / 15));
    const interval = setInterval(() => {
      current += increment;
      if (current >= target) {
        el.textContent = target;
        clearInterval(interval);
      } else {
        el.textContent = current;
      }
    }, 50);
  });
}

// ── Library ──
// 知識庫預設只顯示最近新增的卡片數量；點「顯示全部」後解除限制
const LIBRARY_DEFAULT_LIMIT = 21;
let libraryShowAll = false;

// ── 分類篩選的自訂下拉 ──
// 不用原生 <datalist>：iOS Safari 不會為它畫下拉選單，選項只會出現在鍵盤候選字條，
// 使用者看起來就是「點了沒反應」。
let _filterCategories = [];

function renderCategorySuggestions() {
  const panel = $('#filterCategoryList');
  const input = $('#filterCategory');
  if (!panel || !input) return;

  const query = input.value.trim().toLowerCase();
  // 已完全等於某個分類時列出全部，方便直接改選其他分類
  const exact = _filterCategories.some(c => c.toLowerCase() === query);
  const list = (!query || exact)
    ? _filterCategories
    : _filterCategories.filter(c => c.toLowerCase().includes(query));

  if (list.length === 0) {
    closeCategorySuggestions();
    return;
  }
  panel.innerHTML = list.map(cat =>
    `<div class="filter-suggestion-item" role="option" data-val="${escapeHtml(cat)}">${escapeHtml(cat)}</div>`
  ).join('');
  panel.style.display = 'block';
  input.setAttribute('aria-expanded', 'true');
}

function openCategorySuggestions() {
  renderCategorySuggestions();
}

function closeCategorySuggestions() {
  const panel = $('#filterCategoryList');
  if (!panel) return;
  panel.style.display = 'none';
  $('#filterCategory')?.setAttribute('aria-expanded', 'false');
}

function initCategorySuggestions() {
  const input = $('#filterCategory');
  const panel = $('#filterCategoryList');
  const wrapper = input?.closest('.filter-select-wrapper');
  if (!input || !panel || !wrapper) return;

  input.addEventListener('focus', openCategorySuggestions);
  // 已聚焦時再點一下可重新展開（例如剛選完關閉後）
  input.addEventListener('click', openCategorySuggestions);

  // 用 pointerdown 並擋掉預設行為，避免 input 先 blur 導致面板消失後才收到 click
  panel.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.filter-suggestion-item');
    if (!item) return;
    e.preventDefault();
    input.value = item.dataset.val;
    $('#clearFilterCategory').style.display = 'flex';
    wrapper.classList.add('has-value');
    libraryShowAll = false;
    closeCategorySuggestions();
    renderLibrary();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!wrapper.contains(e.target)) closeCategorySuggestions();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeCategorySuggestions(); input.blur(); }
  });
}

function initLibrary() {
  $('#searchInput').addEventListener('input', () => { libraryShowAll = false; renderLibrary(); });
  const filterInput = $('#filterCategory');
  const clearBtn = $('#clearFilterCategory');
  const wrapper = filterInput.closest('.filter-select-wrapper');
  filterInput.addEventListener('input', () => {
    const hasValue = !!filterInput.value;
    clearBtn.style.display = hasValue ? 'flex' : 'none';
    wrapper.classList.toggle('has-value', hasValue);
    libraryShowAll = false;
    renderLibrary();
    openCategorySuggestions();
  });
  clearBtn.addEventListener('click', () => {
    filterInput.value = '';
    clearBtn.style.display = 'none';
    wrapper.classList.remove('has-value');
    libraryShowAll = false;
    filterInput.focus();
    renderLibrary();
    openCategorySuggestions();
  });
  initCategorySuggestions();
  $('#libraryShowAllBtn').addEventListener('click', () => {
    libraryShowAll = true;
    renderLibrary();
  });
}

function renderLibrary() {
  const grid = $('#libraryGrid');
  const searchTerm = $('#searchInput').value.toLowerCase().trim();
  const filterCat = $('#filterCategory').value;

  const activeCards = getCardsByLang();

  // Update category filter
  updateCategoryFilter(activeCards);

  // Filter cards
  let filtered = [...activeCards];

  if (searchTerm) {
    filtered = filtered.filter(c =>
      c.word.toLowerCase().includes(searchTerm) ||
      c.meaning.toLowerCase().includes(searchTerm) ||
      (c.pronunciation && c.pronunciation.toLowerCase().includes(searchTerm)) ||
      (c.example && c.example.toLowerCase().includes(searchTerm))
    );
  }

  if (filterCat) {
    const filterCatLower = filterCat.toLowerCase();
    filtered = filtered.filter(c => {
      if (!c.category) return false;
      const tags = c.category.split(',').map(t => t.trim().toLowerCase());
      return tags.some(t => t.includes(filterCatLower));
    });
  }

  // Sort by creation date (newest first)
  filtered.sort((a, b) => b.createdAt - a.createdAt);

  // 預設(無搜尋、無分類篩選且未展開)只顯示最近新增的 N 張
  const isDefaultView = !searchTerm && !filterCat && !libraryShowAll;
  const totalCount = filtered.length;
  const truncated = isDefaultView && totalCount > LIBRARY_DEFAULT_LIMIT;
  if (truncated) {
    filtered = filtered.slice(0, LIBRARY_DEFAULT_LIMIT);
  }

  // 更新「顯示全部」提示列
  const showAllBar = $('#libraryShowAllBar');
  if (showAllBar) {
    if (truncated) {
      $('#libraryShowAllHint').textContent = `顯示最近 ${LIBRARY_DEFAULT_LIMIT} 張，共 ${totalCount} 張`;
      showAllBar.style.display = 'flex';
    } else {
      showAllBar.style.display = 'none';
    }
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" id="emptyLibrary" style="grid-column: 1 / -1;">
        <div class="empty-icon">${activeCards.length === 0 ? ICON_INBOX : ICON_SEARCH}</div>
        <h3>${activeCards.length === 0 ? '此語言的知識庫是空的' : '找不到結果'}</h3>
        <p>${activeCards.length === 0 ? '開始新增字句來建立你的學習庫吧！' : '試試其他搜尋關鍵字'}</p>
      </div>`;
    return;
  }

  const levelNames = ['新學', '初學', '學習中', '熟悉中', '進階', '精通', '大師'];
  const checkinTodayKey = todayKey();

  grid.innerHTML = filtered.map(card => {
    const levelClass = `level-${Math.min(card.level, 6)}`;
    const levelText = levelNames[Math.min(card.level, 6)];
    const nextReview = getRelativeDay(card.nextReview);

    return `
      <div class="library-card ${levelClass}" data-id="${card.id}">
        <div class="library-card-header">
          <div>
            <div class="library-card-word">${escapeHtml(card.word)}</div>
            ${card.pronunciation ? `<div class="library-card-pronunciation">${escapeHtml(card.pronunciation)}</div>` : ''}
          </div>
          <div class="library-card-actions">
            <button class="library-speak-btn" title="播放發音" data-word="${escapeHtml(card.word)}" data-lang="${card.lang || 'en-US'}" data-audio-url="${escapeHtml(card.audioUrl || '')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            </button>
            <button class="card-action-btn edit" title="編輯" data-id="${card.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            <button class="card-action-btn delete" title="刪除" data-id="${card.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="library-card-meaning">${escapeHtml(card.meaning)}</div>
        ${card.example ? `<div class="library-card-example">${escapeHtml(card.example)}</div><button class="example-expand-btn" style="display:none" aria-expanded="false">展開 ▾</button>` : ''}
        <div class="library-card-footer">
          ${card.category ? `<span class="library-card-tag">${escapeHtml(card.category)}</span>` : '<span></span>'}
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span class="library-card-level ${levelClass}">${levelText}</span>
            <span class="library-card-next"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${nextReview}</span>
          </div>
        </div>
        <div class="library-card-checkin">
          <label class="checkin-label" title="打勾即完成今日打卡，每日 00:00 (+8) 更新">
            <input type="checkbox" class="card-checkin-box" data-id="${card.id}" ${isCardChecked(card.id, checkinTodayKey) ? 'checked' : ''}>
            <span>今日打卡</span>
          </label>
          <button type="button" class="card-record-btn" data-id="${card.id}" title="查看打卡紀錄">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 2v4M16 2v4"/></svg>
            打卡紀錄
          </button>
        </div>
      </div>`;
  }).join('');

  // Attach delete listeners
  grid.querySelectorAll('.card-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTargetId = btn.dataset.id;
      $('#deleteModal').classList.add('active');
    });
  });

  // Attach edit listeners
  grid.querySelectorAll('.card-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });

  // Attach speak listeners in library
  grid.querySelectorAll('.library-speak-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      playOrSpeak({ audioUrl: btn.dataset.audioUrl }, btn.dataset.word, btn.dataset.lang, btn);
    });
  });

  // Attach 今日打卡 checkbox listeners
  grid.querySelectorAll('.card-checkin-box').forEach(box => {
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', () => {
      toggleCardCheck(box.dataset.id);
    });
  });

  // Attach 打卡紀錄 button listeners
  grid.querySelectorAll('.card-record-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCardRecordModal(btn.dataset.id);
    });
  });

  // 備註展開/收合
  grid.querySelectorAll('.library-card-example').forEach(el => {
    if (el.scrollHeight > el.clientHeight + 2) {
      const btn = el.nextElementSibling;
      if (btn?.classList.contains('example-expand-btn')) btn.style.display = 'inline-block';
    }
  });
  grid.querySelectorAll('.example-expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const exEl = btn.previousElementSibling;
      const expanded = exEl.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', expanded);
      btn.textContent = expanded ? '收合 ▴' : '展開 ▾';
    });
  });
}

// Tracks the old audio URL when the user opens the edit modal
let editOldAudioUrl = null;
// Tracks a new audio URL that was uploaded during this edit session (to prompt old-file cleanup on save)
let pendingOldAudioFileIdForEdit = null;

function openEditModal(id) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  // Reset pending state
  editOldAudioUrl = card.audioUrl || '';
  pendingOldAudioFileIdForEdit = null;

  $('#editCardId').value = card.id;
  $('#editWord').value = card.word || '';
  $('#editPronunciation').value = card.pronunciation || '';
  $('#editMeaning').value = card.meaning || '';
  $('#editExample').value = card.example || '';
  // Use tag-input to populate category chips
  _editTagInput?.setTags(card.category || '');
  $('#editAudioUrl').value = card.audioUrl || '';
  setLangValue('editLang', getLangLabel(card.lang) || card.lang || '');
  // Populate imageUrl hidden field
  $('#editImageUrl').value = card.imageUrl || '';
  _editImageUrl = card.imageUrl || '';

  // Reset edit status UI
  const statusEl = $('#editAudioStatus');
  if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
  const imgStatusEl = $('#editMeaningImageStatus');
  if (imgStatusEl) {
    imgStatusEl.style.display = 'none';
    imgStatusEl.className = _editImageUrl ? 'audio-status success' : 'audio-status';
    imgStatusEl.textContent = _editImageUrl ? '已有圖片' : '';
  }
  const editTransStatusEl = $('#editTranslateStatus');
  if (editTransStatusEl) { editTransStatusEl.style.display = 'none'; editTransStatusEl.textContent = ''; }

  $('#editModal').classList.add('active');
}

// Keeps the category suggestions dropdown updated
function updateCategoryDatalist() {
  const datalist = $('#categoryList');
  if (!datalist) return;

  const allTags = [];
  cards.forEach(c => {
    if (c.category) {
      c.category.split(',').forEach(tag => allTags.push(tag.trim()));
    }
  });
  const categories = [...new Set(allTags)].filter(Boolean).sort();
  datalist.innerHTML = categories.map(cat => `<option value="${escapeHtml(cat)}">`).join('');
}

function updateCategoryFilter(activeCards) {
  const allTags = [];
  activeCards.forEach(c => {
    if (c.category) {
      c.category.split(',').forEach(tag => allTags.push(tag.trim()));
    }
  });
  // 供自訂下拉使用；面板開啟中則同步刷新內容
  _filterCategories = [...new Set(allTags)].filter(Boolean).sort();
  if ($('#filterCategoryList')?.style.display === 'block') renderCategorySuggestions();
}

// ── Modal ──
function initModal() {
  $('#cancelDelete').addEventListener('click', () => {
    $('#deleteModal').classList.remove('active');
    deleteTargetId = null;
  });

  $('#confirmDelete').addEventListener('click', async () => {
    if (deleteTargetId) {
      // Find the card before removing it so we can check its audioUrl
      const deletedCard = cards.find(c => c.id === deleteTargetId);
      cards = cards.filter(c => c.id !== deleteTargetId);
      saveCardsToLocal();
      renderLibrary();
      showToast('卡片已刪除');

      // Await to ensure mobile browsers don't kill the request
      await deleteCardFromNotion(deleteTargetId);

      // Silently delete Drive image if applicable (no confirm dialog)
      if (deletedCard && deletedCard.imageUrl) {
        const imgFileId = extractDriveFileId(deletedCard.imageUrl);
        if (imgFileId) tryDeleteDriveAudio(imgFileId);
      }

      // Offer to delete Drive audio if applicable
      if (deletedCard && deletedCard.audioUrl) {
        const fileId = extractDriveFileId(deletedCard.audioUrl);
        if (fileId && !isAudioSharedWithOtherCards(fileId, deleteTargetId)) {
          // Small delay so the delete modal closes first
          setTimeout(() => {
            if (confirm('是否一起從 Google Drive 刪除這張卡片的音檔？\n（僅會刪除由本系統上傳的檔案）')) {
              tryDeleteDriveAudio(fileId);
            }
          }, 300);
        }
      }
    }
    $('#deleteModal').classList.remove('active');
    deleteTargetId = null;
  });

  // Close on overlay click (Delete Modal)
  $('#deleteModal').addEventListener('click', (e) => {
    if (e.target === $('#deleteModal')) {
      $('#deleteModal').classList.remove('active');
      deleteTargetId = null;
    }
  });

  // Card Check-in Record Modal
  const cardRecordModal = $('#cardRecordModal');
  if (cardRecordModal) {
    $('#cardRecordClose').addEventListener('click', () => cardRecordModal.classList.remove('active'));
    cardRecordModal.addEventListener('click', (e) => {
      if (e.target === cardRecordModal) cardRecordModal.classList.remove('active');
    });
    initHabitDragScroll($('#cardRecordScroll'));
  }

  // Edit Modal Event Listeners
  $('#cancelEdit').addEventListener('click', () => {
    $('#editModal').classList.remove('active');
    const ets = $('#editTranslateStatus');
    if (ets) { ets.style.display = 'none'; ets.textContent = ''; }
  });

  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Flush any lingering tag text before saving
    if ($('#editTagInput') && $('#editTagInput').value.trim()) {
      const text = $('#editTagInput').value.trim();
      const tags = $('#editCategory').value ? $('#editCategory').value.split(',') : [];
      if (!tags.includes(text)) tags.push(text);
      $('#editCategory').value = tags.filter(Boolean).join(',');
      $('#editTagInput').value = '';
      _editTagInput?.renderChips();
    }
    const id = $('#editCardId').value;
    const card = cards.find(c => c.id === id);
    if (!card) return;

    const newAudioUrl = $('#editAudioUrl').value.trim();
    const oldFileId = extractDriveFileId(editOldAudioUrl);
    const newFileId = extractDriveFileId(newAudioUrl);

    card.word = $('#editWord').value.trim();
    card.pronunciation = $('#editPronunciation').value.trim();
    card.meaning = $('#editMeaning').value.trim();
    card.example = $('#editExample').value.trim();
    card.category = $('#editCategory').value.trim();
    const newImageUrl = $('#editImageUrl').value.trim() || '';
    const oldImageFileId = extractDriveFileId(card.imageUrl);
    const newImageFileId = extractDriveFileId(newImageUrl);

    card.imageUrl = newImageUrl !== '' ? newImageUrl : (card.imageUrl || '');
    // Validate: meaning required unless image present
    if (!card.meaning && !card.imageUrl) {
      showToast('請輸入翻譯，或上傳圖片');
      return;
    }
    card.audioUrl = newAudioUrl;
    card.lang = getLangValue('editLang');

    saveCardsToLocal();
    renderLibrary();
    showToast('卡片已更新');
    $('#editModal').classList.remove('active');

    // Decouple from submit event lifecycle
    setTimeout(() => {
      saveCardToNotion(card);
    }, 100);

    // Offer to delete old Drive audio if it changed and old file is from our system
    if (oldFileId && oldFileId !== newFileId && !isAudioSharedWithOtherCards(oldFileId, id)) {
      setTimeout(() => {
        if (confirm('舊音源是否一起從 Google Drive 刪除？\n（僅會刪除由本系統上傳的檔案）')) {
          tryDeleteDriveAudio(oldFileId);
        }
      }, 300);
    }

    // Silently delete old Drive image if it changed
    if (oldImageFileId && oldImageFileId !== newImageFileId && !isAudioSharedWithOtherCards(oldImageFileId, id)) {
      tryDeleteDriveAudio(oldImageFileId);
    }
  });

  // ⚠️ 編輯中不開放點遮罩關閉，避免誤觸關閉視窗
  // 使用者需透過「取消」或「儲存變更」按鈕離開
}

// ── Settings ──
function initSettings() {
  const modal = $('#settingsModal');

  // Show hardcoded URL (read-only)
  $('#sheetUrlDisplay').textContent = DEFAULT_NOTION_URL;

  // Open settings
  $('#settingsBtn').addEventListener('click', () => {
    // Refresh color pickers from saved theme
    const savedTheme = localStorage.getItem('crystal_learning_theme');
    try {
      const theme = savedTheme ? JSON.parse(savedTheme) : {};
      $('#colorBgPrimary').value = theme.bgPrimary || '#0a0a1a';
      $('#colorAccent').value = theme.accentPrimary || '#6366f1';
    } catch (e) {
      $('#colorBgPrimary').value = '#0a0a1a';
      $('#colorAccent').value = '#6366f1';
    }
    modal.classList.add('active');
  });

  // Cancel
  $('#cancelSettings').addEventListener('click', () => {
    modal.classList.remove('active');
    loadTheme(); // Revert any unsaved live previews
  });

  // Theme Live Preview
  $('#colorBgPrimary').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--bg-primary', e.target.value);
  });
  $('#colorAccent').addEventListener('input', (e) => {
    const hex = e.target.value;
    const secondary = getSecondaryAccent(hex);
    document.documentElement.style.setProperty('--accent-primary', hex);
    document.documentElement.style.setProperty('--accent-secondary', secondary);
    document.documentElement.style.setProperty('--text-accent', hex);
    document.documentElement.style.setProperty('--gradient-primary', hex);
  });

  // Theme Presets
  $('#presetDeepPurple')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#3A2C37', accentPrimary: '#5E5F87' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「深遂紫」配色');
  });

  $('#presetMidnightBlue')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#14213d', accentPrimary: '#fca311' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「深夜藍」配色');
  });

  $('#presetVibrantYellow')?.addEventListener('click', () => {
    const preset = {
      bgPrimary: '#f5c400', accentPrimary: '#555555',
      textPrimary: '#555555', textSecondary: '#606060', textMuted: '#5a5a5a',
      bgGlass: 'rgba(0,0,0,0.06)', borderLight: 'rgba(0,0,0,0.12)'
    };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「活力黃」配色');
  });

  $('#presetGreenBrown')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#3a3207', accentPrimary: '#babd8d' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「綠野棕」配色');
  });

  $('#presetIceCrystalBlue')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#001524', accentPrimary: '#9bf6ff' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「冰晶藍」配色');
  });

  $('#presetSoftPink')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#696969', accentPrimary: '#CC8899',
      textSecondary: '#cccccc', textMuted: '#bbbbbb' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「溫柔粉」配色');
  });

  $('#presetSunsetOrange')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#F8D7C4', accentPrimary: '#6C899D',
      textPrimary: '#555555', textSecondary: '#606060', textMuted: '#5a5a5a',
      bgGlass: 'rgba(0,0,0,0.06)', borderLight: 'rgba(0,0,0,0.12)' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「黃昏橙」配色');
  });

  $('#presetCharcoalGray')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#45494C', accentPrimary: '#C59C5D' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「質感灰」配色');
  });

  $('#presetEarthGreen')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#626A56', accentPrimary: '#D6A4A4',
      textSecondary: '#cccccc', textMuted: '#bbbbbb' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「質感綠」配色');
  });

  $('#presetSoftGreen')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#454542', accentPrimary: '#ACB8AA' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「溫柔綠」配色');
  });

  $('#presetSoftPurple')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#8B72BE', accentPrimary: '#4B3621',
      textPrimary: '#2a2a2a', textSecondary: '#444444', textMuted: '#555555',
      bgGlass: 'rgba(255,255,255,0.18)', borderLight: 'rgba(255,255,255,0.30)',
      bgCard: 'rgba(255,255,255,0.20)', bgCardHover: 'rgba(255,255,255,0.28)' };
    applyTheme(preset); saveTheme(preset);
    showToast('已套用「溫柔紫」配色');
  });

  // Theme Reset
  $('#resetThemeBtn').addEventListener('click', () => {
    localStorage.removeItem('crystal_learning_theme');
    applyTheme({});
    showToast('已還原為預設配色');
  });

  // Save
  $('#saveSettings').addEventListener('click', () => {
    // Save Theme Configuration（保留 preset 的文字色等額外屬性）
    const existingSaved = (() => {
      try { return JSON.parse(localStorage.getItem('crystal_learning_theme') || '{}'); } catch(e) { return {}; }
    })();
    const currentTheme = {
      ...existingSaved,
      bgPrimary: $('#colorBgPrimary').value !== '#0a0a1a' ? $('#colorBgPrimary').value : '',
      accentPrimary: $('#colorAccent').value !== '#6366f1' ? $('#colorAccent').value : '',
    };
    saveTheme(currentTheme);
    modal.classList.remove('active');
    showToast('設定已儲存');
  });

  // 以本機覆寫雲端：單向上傳、會蓋掉雲端現有內容，先跳二次確認
  const overwriteModal = $('#overwriteCloudModal');

  $('#syncNowBtn').addEventListener('click', () => {
    modal.classList.remove('active');
    $('#overwriteCardCount').textContent = cards.length;
    overwriteModal.classList.add('active');
  });

  // 取消就退回設定，不要讓使用者莫名回到主畫面
  const cancelOverwrite = () => {
    overwriteModal.classList.remove('active');
    modal.classList.add('active');
  };
  $('#cancelOverwriteCloud').addEventListener('click', cancelOverwrite);
  overwriteModal.addEventListener('click', (e) => {
    if (e.target === overwriteModal) cancelOverwrite();
  });

  $('#confirmOverwriteCloud').addEventListener('click', async () => {
    overwriteModal.classList.remove('active');
    showLoading('正在用本機資料覆寫雲端...');

    try {
      updateSyncStatus('syncing');
      await NotionAPI.syncAll(cards);
      updateSyncStatus('connected');
      lastSyncAt = Date.now(); // 剛推完，雲端就是本機，不必馬上再拉一次
      showToast(`已用本機 ${cards.length} 張卡片覆寫雲端`);
    } catch (e) {
      console.error('Overwrite cloud failed:', e);
      updateSyncStatus('error');
      showToast('覆寫失敗，請檢查連線');
    } finally {
      hideLoading();
    }
  });

  // Click sync status to open settings
  $('#syncStatusBtn').addEventListener('click', () => {
    modal.classList.add('active');
  });

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
}

// ── Utility Functions ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Keyboard Shortcuts ──
document.addEventListener('keydown', (e) => {
  // Don't trigger if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case '1':
      switchView('dashboard');
      break;
    case '2':
      switchView('add');
      break;
    case '3':
      switchView('review');
      break;
    case '4':
      switchView('library');
      break;
    case ' ':
    case 'Enter':
      // Flip card during review
      if ($('#reviewView').classList.contains('active') && $('#flashcardContainer').style.display !== 'none') {
        e.preventDefault();
        $('#flashcard').click();
      }
      break;
    case 'ArrowLeft':
    case 'a':
      // Rating: forgot
      if ($('#ratingContainer').classList.contains('visible')) {
        e.preventDefault();
        handleRating(0);
      }
      break;
    case 'ArrowDown':
    case 's':
      // Rating: hard
      if ($('#ratingContainer').classList.contains('visible')) {
        e.preventDefault();
        handleRating(1);
      }
      break;
    case 'ArrowUp':
    case 'd':
      // Rating: good
      if ($('#ratingContainer').classList.contains('visible')) {
        e.preventDefault();
        handleRating(2);
      }
      break;
    case 'ArrowRight':
    case 'f':
      // Rating: easy
      if ($('#ratingContainer').classList.contains('visible')) {
        e.preventDefault();
        handleRating(3);
      }
      break;
    case 'p':
      // Speak current word
      if ($('#reviewView').classList.contains('active') && currentReviewIndex < reviewQueue.length) {
        e.preventDefault();
        const card = reviewQueue[currentReviewIndex];
        const isFlipped = $('#flashcard').classList.contains('flipped');
        const mode = $('#reviewModeSelect').value;

        let shouldSpeakWord = false;
        if (mode === 'word-first') {
          shouldSpeakWord = !isFlipped; // Front = Word, Back = Meaning
        } else {
          shouldSpeakWord = isFlipped; // Front = Meaning, Back = Word
        }

        if (shouldSpeakWord) {
          playOrSpeak(card, card.word, card.lang || 'en-US', isFlipped ? $('#backSpeakBtn') : $('#frontSpeakBtn'));
        } else {
          speakText(card.meaning, 'zh-TW', isFlipped ? $('#backSpeakBtn') : $('#frontSpeakBtn'));
        }
      }
      break;
  }
});

// ── Audio Helpers ──

// 加入主畫面的 standalone 模式沒有分頁可開，window.open 幾乎無效，失敗時要改走別的路
function isStandaloneApp() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

// iOS 規定 <audio> 必須先在使用者手勢中 play 過，之後才允許用程式控制播放。
// 每次 new Audio() 都是新元素、都要重新解鎖，所以全程共用同一顆。
let sharedAudio = null;
let audioUnlocked = false;
let silentWavUrl = null;

function getSharedAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
    sharedAudio.playsInline = true;
    sharedAudio.setAttribute('playsinline', '');
  }
  return sharedAudio;
}

// 產生一段極短的無聲 wav 當解鎖用音源
function getSilentWavUrl() {
  if (silentWavUrl) return silentWavUrl;
  const sampleRate = 8000;
  const samples = Math.round(sampleRate * 0.05);
  const buf = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, samples * 2, true);
  silentWavUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentWavUrl;
}

// capture 階段先跑，確保連「第一次點發音鈕」都已經解鎖
function unlockAudioPlayback() {
  if (audioUnlocked) return;
  const audio = getSharedAudio();
  if (!audio.paused || audio.currentTime > 0) { audioUnlocked = true; return; }
  audioUnlocked = true;
  try {
    audio.src = getSilentWavUrl();
    const p = audio.play();
    if (p && p.catch) p.catch(() => { });
  } catch (e) { }
}
// speechSynthesis 在 iOS 一樣要先在使用者手勢中 speak 過一次才會解鎖。
// 系統發音是「Drive 全部失敗後」才叫的，那時早就脫離手勢了，不先解鎖就會被靜默擋掉、完全沒聲音
let ttsUnlocked = false;
function unlockSpeechSynthesis() {
  if (ttsUnlocked || !window.speechSynthesis) return;
  ttsUnlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.rate = 10; // 盡快結束，不要卡住後面真正要唸的內容
    window.speechSynthesis.speak(u);
  } catch (e) { }
}

function unlockMediaPlayback() {
  unlockAudioPlayback();
  unlockSpeechSynthesis();
}
document.addEventListener('touchend', unlockMediaPlayback, true);
document.addEventListener('click', unlockMediaPlayback, true);

function playOrSpeak(card, defaultText, lang, btnElement) {
  const langCode = getLangCode(lang);
  if (card.audioUrl) {
    const isDriveUrl = /drive\.google\.com|docs\.google\.com/.test(card.audioUrl);
    const ytId = extractYouTubeId(card.audioUrl);

    if (isDriveUrl) {
      playGoogleDriveAudio(card.audioUrl, btnElement, () => {
        if (langCode) speakText(defaultText, langCode, btnElement);
      });
      return;
    }

    if (ytId) {
      window.open(card.audioUrl, '_blank');
      return;
    }

    if (card.audioUrl.match(/\.(mp3|wav|ogg|m4a|aac)$/i)) {
      playDirectAudio(card.audioUrl, btnElement, () => {
        if (langCode) speakText(defaultText, langCode, btnElement);
      });
      return;
    }

    // Default fallback: open any unstructured link in a new tab
    window.open(card.audioUrl, '_blank');
  } else {
    if (langCode) speakText(defaultText, langCode, btnElement);
  }
}

// ── Audio Upload & Recording ──
async function uploadAudioToDrive(blob, filename, lang, statusEl, targetInput) {
  if (!statusEl || !targetInput) return;
  statusEl.className = 'audio-status uploading';
  statusEl.textContent = '上傳中，請稍候...';
  statusEl.style.display = 'block';

  try {
    const base64Data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const shareUrl = await NotionAPI.uploadAudio(base64Data, filename, blob.type, lang);
    targetInput.value = shareUrl;
    statusEl.className = 'audio-status success';
    statusEl.textContent = `音檔上傳成功！(${lang || 'other'})`;
    showToast('音檔上傳成功！');
  } catch (e) {
    console.error('Audio upload failed:', e);
    statusEl.className = 'audio-status error';
    statusEl.textContent = '上傳失敗：' + e.message;
    showToast('音檔上傳失敗：' + e.message);
  }
}

function initAudioActions() {
  // Helper to bind both Add and Edit forms
  const bindAudioButtons = (uploadBtnId, recordBtnId, fileInputId, statusId, audioUrlInputId, langSelectId) => {
    const uploadBtn = $(`#${uploadBtnId}`);
    const recordBtn = $(`#${recordBtnId}`);
    const fileInput = $(`#${fileInputId}`);
    const statusEl = $(`#${statusId}`);
    const urlInput = $(`#${audioUrlInputId}`);
    const getLang = () => getLangValue(langSelectId) || 'other';

    if (!uploadBtn || !recordBtn || !fileInput) return;

    // ── Upload from file ──
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      await uploadAudioToDrive(file, file.name, getLang(), statusEl, urlInput);
      fileInput.value = ''; // Reset so same file can be chosen again
    });

    // ── Record from microphone ──
    let mediaRecorder = null;
    let recordedChunks = [];

    recordBtn.addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        // Stop recording
        mediaRecorder.stop();
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.addEventListener('dataavailable', e => {
          if (e.data.size > 0) recordedChunks.push(e.data);
        });

        mediaRecorder.addEventListener('stop', async () => {
          // Stop all tracks to release microphone
          stream.getTracks().forEach(t => t.stop());
          recordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> 錄音`;
          recordBtn.classList.remove('recording');

          const mimeType = mediaRecorder.mimeType || 'audio/webm';
          const blob = new Blob(recordedChunks, { type: mimeType });
          const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
          const filename = `recording_${Date.now()}.${ext}`;
          await uploadAudioToDrive(blob, filename, getLang(), statusEl, urlInput);
        });

        mediaRecorder.start();
        recordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> 停止錄音`;
        recordBtn.classList.add('recording');

        if (statusEl) {
          statusEl.className = 'audio-status recording';
          statusEl.textContent = '錄音中...';
          statusEl.style.display = 'block';
        }
      } catch (e) {
        console.error('Microphone access error:', e);
        showToast('無法存取麥克風，請確認瀏覽器權限');
      }
    });
  };

  bindAudioButtons('addUploadAudioBtn', 'addRecordAudioBtn', 'addAudioFileInput', 'addAudioStatus', 'inputAudioUrl', 'inputLang');
  bindAudioButtons('editUploadAudioBtn', 'editRecordAudioBtn', 'editAudioFileInput', 'editAudioStatus', 'editAudioUrl', 'editLang');
}

// Global audio object to prevent overlapping playback
let currentAudio = null;

// fileId → blob object URL（抓過的音檔，重播直接用不再連網）
const driveBlobCache = {};

// fileId → 上次全部失敗的時間，這段期間內再點就直接跳系統發音，不重跑一輪等待
const driveFailCache = {};
const DRIVE_FAIL_TTL = 60 * 1000;

// 在共用的 audio 元素上播放；resolve = 真的開始播了，reject = 這個來源不能用
// 重點：play() 要在同一個 tick 內叫，中間不能 await，否則 iOS 會判定脫離使用者手勢
function playOnSharedAudio(src, btnElement, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const audio = getSharedAudio();
    audio.onended = null;
    audio.onerror = null;
    try { audio.pause(); } catch (e) { }

    let settled = false;
    let timer = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.onerror = null;
      reject(err || new Error('audio error'));
    };
    const ok = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      currentAudio = audio;
      if (btnElement) btnElement.classList.add('speaking');
      audio.onended = () => { if (btnElement) btnElement.classList.remove('speaking'); };
      audio.onerror = () => { if (btnElement) btnElement.classList.remove('speaking'); };
      resolve();
    };

    timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
    audio.onerror = () => fail(audio.error);
    audio.src = src;
    try {
      const p = audio.play();
      if (p && p.then) p.then(ok).catch(fail);
      else ok();
    } catch (e) { fail(e); }
  });
}

// Drive 真正供檔的網址（drive.google.com/uc 只是 303 轉到這裡）
// 回 audio/mpeg + accept-ranges: bytes + access-control-allow-origin: *
function driveDownloadUrl(fileId) {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
}

// 直接用 <audio src> 載會被 Cross-Origin-Resource-Policy: same-site 擋掉（Safari 嚴格執行，Chrome 較寬鬆）。
// 但這個網址有 ACAO: *，改用 fetch 走 CORS 模式就能拿到內容，轉成 blob URL 後等同同源，
// 連 Content-Disposition: attachment、303 轉址、Range 支援全部一併繞開。
// 失敗要「快點放棄」才不會讓使用者乾等，所有連網動作都掛上逾時
function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

async function fetchDriveBlobUrl(fileId) {
  if (driveBlobCache[fileId]) return driveBlobCache[fileId];
  const res = await fetchWithTimeout(driveDownloadUrl(fileId), { mode: 'cors', credentials: 'omit' }, 3000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  // 檔案太大時 Drive 會先回一頁病毒掃描確認頁，不是音檔
  if (blob.type && blob.type.indexOf('text/html') === 0) throw new Error('Drive 回傳確認頁');
  const blobUrl = URL.createObjectURL(blob);
  driveBlobCache[fileId] = blobUrl;
  return blobUrl;
}

// 後端沒部署 getAudio 端點的話，這條每次都白跑，確認過一次就整個 session 跳過
let driveProxyUnavailable = false;

// 再退一步：請後端把檔案轉 base64 回來（Google 之後改 CORS 政策時的保險）
async function fetchDriveBlobUrlViaProxy(fileId) {
  if (driveBlobCache[fileId]) return driveBlobCache[fileId];
  if (driveProxyUnavailable) throw new Error('後端無 getAudio 端點');
  const proxy = getNotionProxyUrl();
  if (!proxy) throw new Error('尚未設定後端 Proxy URL');

  const sep = proxy.includes('?') ? '&' : '?';
  // Apps Script 本身回應就要 2~3 秒，再加 base64 編碼，逾時不能設太短
  const res = await fetchWithTimeout(`${proxy}${sep}action=getAudio&fileId=${encodeURIComponent(fileId)}`, {}, 12000);
  const json = await res.json();
  // 後端還是舊版時會忽略 action、回傳整包卡片，用有沒有 base64 判斷
  if (!json.success) throw new Error(json.error || 'getAudio failed');
  if (!json.base64) {
    driveProxyUnavailable = true;
    throw new Error('後端尚未重新部署');
  }

  const binary = atob(json.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: json.mimeType || 'audio/mpeg' }));
  driveBlobCache[fileId] = blobUrl;
  return blobUrl;
}

async function playGoogleDriveAudio(url, btnElement, onErrorCallback) {
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!fileIdMatch) {
    playDirectAudio(url, btnElement, onErrorCallback);
    return;
  }

  const fileId = fileIdMatch[1];

  // 這個檔案剛剛才全部試過失敗，不用再讓使用者等一輪，直接退回系統發音
  const failedAt = driveFailCache[fileId];
  if (failedAt && Date.now() - failedAt < DRIVE_FAIL_TTL) {
    if (onErrorCallback) onErrorCallback();
    return;
  }

  if (btnElement) btnElement.classList.add('speaking');

  // 抓過就直接播，不再連網
  if (driveBlobCache[fileId]) {
    try {
      await playOnSharedAudio(driveBlobCache[fileId], btnElement);
      return;
    } catch (err) {
      console.warn('Cached blob playback failed:', err);
      URL.revokeObjectURL(driveBlobCache[fileId]);
      delete driveBlobCache[fileId];
    }
  }

  const errors = [];
  const strategies = [
    ['drive-cors-blob', () => fetchDriveBlobUrl(fileId)],
    ['proxy-base64-blob', () => fetchDriveBlobUrlViaProxy(fileId)],
  ];

  for (const [name, getBlobUrl] of strategies) {
    try {
      const blobUrl = await getBlobUrl();
      await playOnSharedAudio(blobUrl, btnElement, 4000);
      return; // Success
    } catch (err) {
      console.warn(`${name} failed:`, err);
      errors.push(`${name}: ${err.message}`);
    }
  }

  // 最後才試直連 <audio src>：CORP 會擋掉的就是這條，但 Chrome 之類寬鬆的瀏覽器還是能播
  // 只試最終供檔網址就好，drive.google.com/uc 只是 303 轉到同一個位置，試兩次是白等
  try {
    await playOnSharedAudio(driveDownloadUrl(fileId), btnElement);
    return;
  } catch (err) {
    console.warn('Direct playback failed:', err);
  }

  if (btnElement) btnElement.classList.remove('speaking');
  driveFailCache[fileId] = Date.now();

  // standalone（加入主畫面）開新分頁多半沒反應，直接退回系統發音比較有用
  if (isStandaloneApp()) {
    showToast(`音檔播放失敗（${errors[0] || '未知原因'}），改用系統發音`);
    if (onErrorCallback) onErrorCallback();
    return;
  }

  showToast('Google Drive 阻擋了直接播放，為您開啟新分頁聆聽！');
  window.open(url, '_blank');
}

function playDirectAudio(url, btnElement, onErrorCallback) {
  playOnSharedAudio(url, btnElement).catch(e => {
    console.warn('Audio play blocked or failed:', e);
    if (btnElement) btnElement.classList.remove('speaking');
    if (onErrorCallback) onErrorCallback();
  });
}

// ── Auto-Translate & OCR Smart Input ──

// Map card lang to MyMemory language code
const MYMEMORY_LANG_MAP = {
  'en-US': 'en', 'en-GB': 'en', 'ja-JP': 'ja', 'zh-TW': 'zh-TW',
  'ko-KR': 'ko', 'fr-FR': 'fr', 'de-DE': 'de', 'es-ES': 'es',
  'it-IT': 'it', 'pt-BR': 'pt', 'th-TH': 'th', 'vi-VN': 'vi',
};

// Map card lang to Tesseract language code
const TESSERACT_LANG_MAP = {
  'en-US': 'eng', 'en-GB': 'eng', 'ja-JP': 'jpn', 'zh-TW': 'chi_tra',
  'ko-KR': 'kor', 'fr-FR': 'fra', 'de-DE': 'deu', 'es-ES': 'spa',
  'it-IT': 'ita', 'pt-BR': 'por', 'th-TH': 'tha', 'vi-VN': 'vie',
};

async function autoTranslate(word, fromLang, statusEl) {
  if (!word) return;
  const from = MYMEMORY_LANG_MAP[getLangCode(fromLang) || fromLang] || 'en';
  const to = 'zh-TW';

  statusEl.style.display = 'block';
  statusEl.textContent = '翻譯中...';
  statusEl.className = 'audio-status uploading';

  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${from}|${to}`
    );
    const data = await res.json();
    const translated = data?.responseData?.translatedText;

    if (translated && translated !== word) {
      $('#inputMeaning').value = translated;
      statusEl.textContent = `翻譯成功！`;
      statusEl.className = 'audio-status success';
    } else {
      statusEl.textContent = '無法翻譯，請手動填寫';
      statusEl.className = 'audio-status error';
    }
  } catch (e) {
    statusEl.textContent = '翻譯服務無法連線';
    statusEl.className = 'audio-status error';
  }
}

async function runOCR(imageFile, _lang) {
  const overlay = $('#ocrOverlay');
  const wordList = $('#ocrWordList');
  const fullText = $('#ocrFullText');
  const confirmBtn = $('#ocrConfirmBtn');
  const confirmLabel = $('#ocrConfirmLabel');
  let selectedWords = new Set();

  overlay.style.display = 'flex';
  wordList.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.35rem;color:var(--text-muted);font-size:0.85rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>傳送至 Google Vision 辨識中...</span>`;
  fullText.textContent = '';
  if (confirmLabel) confirmLabel.textContent = '確認填入（0 個字詞）';
  confirmBtn.disabled = true;

  const syncConfirmBtn = () => {
    const n = selectedWords.size;
    confirmBtn.disabled = n === 0;
    if (confirmLabel) confirmLabel.textContent = `確認填入（${n} 個字詞）`;
  };
  confirmBtn.onclick = () => {
    if (selectedWords.size === 0) return;
    $('#inputWord').value = [...selectedWords].join('');
    overlay.style.display = 'none';
  };

  try {
    const proxyUrl = getNotionProxyUrl();
    if (!proxyUrl) {
      throw new Error('請先在設定中填入 Proxy URL');
    }

    // Compress image to ≤ 1MB before sending (Cloud Vision limit)
    wordList.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.35rem;color:var(--text-muted);font-size:0.85rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>壓縮圖片中...</span>`;
    const compressed = await compressImage(imageFile, 800); // 800KB safe margin
    if (!compressed) throw new Error('圖片壓縮失敗');

    wordList.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.35rem;color:var(--text-muted);font-size:0.85rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Google Vision 辨識中...</span>`;

    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'ocrImage',
        base64Data: compressed.base64,
        mimeType: compressed.mimeType,
      }),
    });
    const json = await res.json();

    if (!json.success) {
      throw new Error(json.error || 'OCR 失敗');
    }

    const text = json.fullText || '';
    fullText.textContent = text || '(未辨識到文字)';

    const words = json.words || [];

    wordList.innerHTML = '';

    if (words.length === 0 && !text) {
      wordList.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">未辨識到文字，請嘗試更清晰的照片</span>';
      return;
    }

    // If no word tokens, split full text into candidates
    const candidates = words.length > 0 ? words :
      text.split(/\s+/).filter(w => w.length > 0);
    const unique = [...new Set(candidates)].slice(0, 30); // cap at 30 chips

    // Show multi-select chips
    unique.forEach(word => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'lang-btn ocr-word-chip';
      chip.style.cssText = 'font-size:0.9rem;padding:0.4rem 0.8rem';
      chip.textContent = word;
      chip.addEventListener('click', () => {
        if (selectedWords.has(word)) {
          selectedWords.delete(word);
          chip.classList.remove('selected');
        } else {
          selectedWords.add(word);
          chip.classList.add('selected');
        }
        syncConfirmBtn();
      });
      wordList.appendChild(chip);
    });

    // Auto-select if only one token
    if (unique.length === 1) {
      wordList.querySelector('.ocr-word-chip')?.click();
    }

  } catch (e) {
    console.error('[OCR]', e);
    wordList.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.35rem;color:var(--text-muted);font-size:0.85rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${e.message || '辨識失敗，請重試'}</span>`;
  }
}



// ── Image compression (client-side, max maxKB) ──
function compressImage(file, maxKB = 50) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      // Scale down if very large
      const MAX_DIM = 1200;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      // Binary search quality for target size
      let lo = 0.1, hi = 0.95, best = null;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const dataUrl = canvas.toDataURL('image/jpeg', mid);
        const base64 = dataUrl.split(',')[1];
        const kb = (base64.length * 3 / 4) / 1024;
        if (kb <= maxKB) { best = dataUrl; lo = mid; }
        else { hi = mid; }
      }
      // Fallback to lowest quality
      if (!best) best = canvas.toDataURL('image/jpeg', 0.1);
      const b64 = best.split(',')[1];
      resolve({ dataUrl: best, base64: b64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── Upload image to Google Drive /img/ directory ──
async function uploadImageToDrive(file, lang, statusEl) {
  const url = getNotionProxyUrl();
  if (!url) return null;
  if (statusEl) {
    statusEl.className = 'audio-status uploading';
    statusEl.style.display = 'block';
    statusEl.textContent = '處理圖片中...';
  }
  const compressed = await compressImage(file, 50);
  if (!compressed) {
    if (statusEl) {
      statusEl.className = 'audio-status error';
      statusEl.textContent = '圖片處理失敗';
    }
    return null;
  }
  if (statusEl) {
    statusEl.className = 'audio-status uploading';
    statusEl.textContent = '上傳中，請稍候...';
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'uploadImage',
        base64Data: compressed.base64,
        filename: `img_${Date.now()}.jpg`,
        mimeType: compressed.mimeType,
        lang: lang || 'other',
      }),
    });
    const json = await res.json();
    if (json.success) {
      if (statusEl) {
        statusEl.className = 'audio-status success';
        statusEl.textContent = '圖片上傳成功！';
      }
      return json.url;
    }
    if (statusEl) {
      statusEl.className = 'audio-status error';
      statusEl.textContent = '上傳失敗：' + (json.error || '');
    }
    return null;
  } catch (e) {
    if (statusEl) {
      statusEl.className = 'audio-status error';
      statusEl.textContent = '上傳失敗';
    }
    return null;
  }
}

// ── Tag Input ──
function initTagInput(textInputEl, chipRowEl, hiddenEl, suggestionsEl) {
  const allTags = () => hiddenEl.value ? hiddenEl.value.split(',').map(t => t.trim()).filter(Boolean) : [];

  const renderChips = () => {
    chipRowEl.innerHTML = '';
    allTags().forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${escapeHtml(tag)}<button type="button" class="tag-remove" aria-label="移除">&times;</button>`;
      chip.querySelector('.tag-remove').addEventListener('click', () => {
        const tags = allTags().filter(t => t !== tag);
        hiddenEl.value = tags.join(',');
        renderChips();
      });
      chipRowEl.appendChild(chip);
    });
  };

  const addTag = (val) => {
    const tag = val.trim();
    if (!tag) return;
    const tags = allTags();
    if (!tags.includes(tag)) tags.push(tag);
    hiddenEl.value = tags.join(',');
    renderChips();
    textInputEl.value = '';
    suggestionsEl.style.display = 'none';
  };

  const showSuggestions = (query) => {
    const allCats = [...new Set(
      cards.flatMap(c => (c.category || '').split(',').map(t => t.trim()))
        .filter(Boolean)
    )];
    const filtered = allCats.filter(c => c.toLowerCase().includes(query.toLowerCase()) && !allTags().includes(c));
    if (filtered.length === 0) { suggestionsEl.style.display = 'none'; return; }
    suggestionsEl.innerHTML = filtered.map(c =>
      `<div class="tag-suggestion-item" data-val="${escapeHtml(c)}">${escapeHtml(c)}</div>`
    ).join('');
    suggestionsEl.style.display = 'block';
    suggestionsEl.querySelectorAll('.tag-suggestion-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent input onBlur from firing first
        addTag(el.dataset.val);
      });
    });
  };

  textInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(textInputEl.value);
    } else if (e.key === 'Backspace' && textInputEl.value === '') {
      const tags = allTags();
      if (tags.length > 0) {
        tags.pop();
        hiddenEl.value = tags.join(',');
        renderChips();
      }
    }
  });
  textInputEl.addEventListener('input', () => showSuggestions(textInputEl.value));
  textInputEl.addEventListener('blur', () => {
    setTimeout(() => { suggestionsEl.style.display = 'none'; }, 200);
    if (textInputEl.value.trim()) addTag(textInputEl.value);
  });
  // clicking wrapper focuses input
  chipRowEl.parentElement?.addEventListener('click', () => textInputEl.focus());

  return { renderChips, setTags: (csv) => { hiddenEl.value = csv || ''; renderChips(); } };
}

let _addImageUrl = ''; // temp storage for pending image URL in Add form
let _isAddingCard = false; // 新增卡片送出中，擋重複送出
let _editImageUrl = ''; // temp storage for pending image URL in Edit modal
let _addTagInput = null;
let _editTagInput = null;

function initSmartInput() {
  // ─ Translate button (Add form) ─
  const translateBtn = $('#autoTranslateBtn');
  const translateStatus = $('#translateStatus');
  if (translateBtn) {
    translateBtn.addEventListener('click', async () => {
      const word = $('#inputWord').value.trim();
      if (!word) { showToast('請先填寫生字'); return; }
      const lang = getLangValue('inputLang');
      await autoTranslate(word, lang, translateStatus);
    });
  }

  // ─ Translate button (Edit modal) ─
  const editTranslateBtn = $('#editAutoTranslateBtn');
  const editTranslateStatus = $('#editTranslateStatus');
  if (editTranslateBtn) {
    editTranslateBtn.addEventListener('click', async () => {
      const word = $('#editWord').value.trim();
      if (!word) { showToast('請先填寫生字'); return; }
      const lang = getLangValue('editLang') || getLangValue('inputLang');
      // 翻譯結果直接填入 editMeaning
      editTranslateStatus.style.display = 'block';
      editTranslateStatus.textContent = '翻譯中...';
      editTranslateStatus.className = 'audio-status uploading';
      const from = MYMEMORY_LANG_MAP[getLangCode(lang) || lang] || 'en';
      try {
        const res = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${from}|zh-TW`
        );
        const data = await res.json();
        const translated = data?.responseData?.translatedText;
        if (translated && translated !== word) {
          $('#editMeaning').value = translated;
          editTranslateStatus.textContent = '翻譯成功！';
          editTranslateStatus.className = 'audio-status success';
        } else {
          editTranslateStatus.textContent = '無法翻譯，請手動填寫';
          editTranslateStatus.className = 'audio-status error';
        }
      } catch (e) {
        editTranslateStatus.textContent = '翻譯服務無法連線';
        editTranslateStatus.className = 'audio-status error';
      }
    });
  }

  // ─ Auto Hiragana button (Add form) ─
  const autoHiraganaBtn = $('#autoHiraganaBtn');
  const inputLang = $('#inputLang');
  if (autoHiraganaBtn && inputLang) {
    const toggleAddHiraganaBtn = () => {
      autoHiraganaBtn.style.display = getLangCode(getLangValue('inputLang')) === 'ja-JP' ? 'inline-flex' : 'none';
    };
    inputLang.addEventListener('change', toggleAddHiraganaBtn);
    toggleAddHiraganaBtn(); // init

    autoHiraganaBtn.addEventListener('click', async () => {
      const word = $('#inputWord').value.trim();
      if (!word) { showToast('請先填寫生字'); return; }
      autoHiraganaBtn.textContent = '轉換中...';
      const hiragana = await fetchHiragana(word);
      if (hiragana) $('#inputPronunciation').value = hiragana;
      autoHiraganaBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg> 轉平假名`;
    });
  }

  // ─ Auto Hiragana button (Edit modal) ─
  const editAutoHiraganaBtn = $('#editAutoHiraganaBtn');
  const editLang = $('#editLang');
  if (editAutoHiraganaBtn && editLang) {
    initLangSelectCustom('editLang');
    const toggleEditHiraganaBtn = () => {
      editAutoHiraganaBtn.style.display = getLangCode(getLangValue('editLang')) === 'ja-JP' ? 'inline-flex' : 'none';
    };
    editLang.addEventListener('change', toggleEditHiraganaBtn);
    toggleEditHiraganaBtn(); // init

    editAutoHiraganaBtn.addEventListener('click', async () => {
      const word = $('#editWord').value.trim();
      if (!word) { showToast('請先填寫生字'); return; }
      editAutoHiraganaBtn.textContent = '轉換中...';
      const hiragana = await fetchHiragana(word);
      if (hiragana) $('#editPronunciation').value = hiragana;
      editAutoHiraganaBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg> 轉平假名`;
    });
  }

  // ─ Photo / OCR button (Add form - for word) ─
  const ocrBtn = $('#ocrPhotoBtn');
  const ocrInput = $('#ocrImageInput');
  if (ocrBtn && ocrInput) {
    ocrBtn.addEventListener('click', () => ocrInput.click());
    ocrInput.addEventListener('change', async () => {
      const file = ocrInput.files[0];
      if (!file) return;
      const lang = getLangValue('inputLang');
      await runOCR(file, lang);
      ocrInput.value = '';
    });
  }

  // ─ Image button (Add form - for meaning/card image) ─
  const meaningImageBtn = $('#meaningImageBtn');
  const meaningImageInput = $('#meaningImageInput');
  const meaningImageStatus = $('#meaningImageStatus');
  if (meaningImageBtn && meaningImageInput) {
    meaningImageBtn.addEventListener('click', () => meaningImageInput.click());
    meaningImageInput.addEventListener('change', async () => {
      const file = meaningImageInput.files[0];
      if (!file) return;
      const lang = getLangValue('inputLang');
      _addImageUrl = await uploadImageToDrive(file, lang, meaningImageStatus) || '';
      meaningImageInput.value = '';
    });
  }

  // ─ Image button (Edit modal - for meaning/card image) ─
  const editMeaningImageBtn = $('#editMeaningImageBtn');
  const editMeaningImageInput = $('#editMeaningImageInput');
  const editMeaningImageStatus = $('#editMeaningImageStatus');
  if (editMeaningImageBtn && editMeaningImageInput) {
    editMeaningImageBtn.addEventListener('click', () => editMeaningImageInput.click());
    editMeaningImageInput.addEventListener('change', async () => {
      const file = editMeaningImageInput.files[0];
      if (!file) return;
      const lang = getLangValue('editLang') || getLangValue('inputLang');
      _editImageUrl = await uploadImageToDrive(file, lang, editMeaningImageStatus) || '';
      editMeaningImageInput.value = '';
      if (_editImageUrl) {
        $('#editImageUrl').value = _editImageUrl;
      }
    });
  }

  // ─ OCR overlay close ─
  $('#ocrOverlayClose')?.addEventListener('click', () => {
    $('#ocrOverlay').style.display = 'none';
  });
  $('#ocrOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('#ocrOverlay')) $('#ocrOverlay').style.display = 'none';
  });

  // ─ Tag inputs ─
  _addTagInput = initTagInput(
    $('#addTagInput'), $('#addTagChips'), $('#inputCategory'), $('#addTagSuggestions')
  );
  _editTagInput = initTagInput(
    $('#editTagInput'), $('#editTagChips'), $('#editCategory'), $('#editTagSuggestions')
  );
}

async function fetchHiragana(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=ja&dt=rm&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const data = await res.json();
    let romaji = '';
    if (data && data[0]) {
      data[0].forEach(segment => {
        if (segment[3]) romaji += segment[3] + ' ';
      });
    }
    if (!romaji) return text; // fallback
    // remove spaces completely since Japanese doesn't use spaces generally
    romaji = romaji.replace(/\s+/g, '').trim();

    // Convert macrons to standard romaji vowels so wanakana can process them
    romaji = romaji.replace(/[āĀ]/g, 'aa')
      .replace(/[īĪ]/g, 'ii')
      .replace(/[ūŪ]/g, 'uu')
      .replace(/[ēĒ]/g, 'ee')
      .replace(/[ōŌ]/g, 'ou');

    if (window.wanakana) {
      return wanakana.toHiragana(romaji);
    }
    return romaji; // return romaji if wanakana fails to load
  } catch (e) {
    console.error('Hiragana fetched failed:', e);
    return text;
  }
}
