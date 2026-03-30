/* =============================================
   CRYSTAL LEARNING - Spaced Repetition System
   Application Logic
   ============================================= */

// ── Spaced Repetition Intervals (in days) ──
const INTERVALS = [0, 1, 2, 4, 7, 15, 30]; // Level 0-6

// ── State ──
let cards = [];
let reviewQueue = [];
let currentReviewIndex = 0;
let reviewStats = { total: 0, correct: 0, wrong: 0 };
let deleteTargetId = null;
let isOnline = false;

// Language Filter: persisted in localStorage
let currentLangFilter = localStorage.getItem('crystal_lang_filter') || 'all';

// ── DOM Elements ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Database Proxy API URL ──
const DEFAULT_NOTION_URL = 'https://script.google.com/macros/s/AKfycbyi3PtLL5wwEdx2feSYHiaRC0FrF-9YXI3P-WXdfVVg0Bmz3ClOs5JKurwkaz69Fw9POA/exec';
// Old deprecated URL — auto-migrate if still stored on this device
const _OLD_NOTION_URL = 'https://script.google.com/macros/s/AKfycbwYDvfHI5XNMhwmF8v4KC7hCOs_xHQXNjelVriO5cpWOu0lxduFcBa40Ex6-CPwWF2q/exec';
(function migrateNotionUrl() {
  const stored = localStorage.getItem('crystal_learning_notion_url');
  // If stored value is the old URL or empty string, clear it so DEFAULT_NOTION_URL takes effect
  if (stored === _OLD_NOTION_URL || stored === '') {
    localStorage.removeItem('crystal_learning_notion_url');
  }
})();

function getNotionProxyUrl() {
  return localStorage.getItem('crystal_learning_notion_url') || DEFAULT_NOTION_URL;
}

function setNotionProxyUrl(url) {
  localStorage.setItem('crystal_learning_notion_url', url);
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
    root.style.setProperty('--bg-card', adjustHexToRgba(theme.bgPrimary, -15, 0.6));
    root.style.setProperty('--bg-card-hover', adjustHexToRgba(theme.bgPrimary, -5, 0.7));
    if ($('#colorBgPrimary')) $('#colorBgPrimary').value = theme.bgPrimary;
  } else {
    root.style.removeProperty('--bg-primary');
    root.style.removeProperty('--bg-header');
    root.style.removeProperty('--bg-card');
    root.style.removeProperty('--bg-card-hover');
    if ($('#colorBgPrimary')) $('#colorBgPrimary').value = '#0a0a1a';
  }

  // 文字色與玻璃效果覆蓋（淺色主題用）
  const textVars = ['--text-primary', '--text-secondary', '--text-muted', '--bg-glass', '--border-light'];
  const textKeys = ['textPrimary', 'textSecondary', 'textMuted', 'bgGlass', 'borderLight'];
  textKeys.forEach((key, i) => {
    if (theme[key]) root.style.setProperty(textVars[i], theme[key]);
    else root.style.removeProperty(textVars[i]);
  });
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

// ── Initialize ──
document.addEventListener('DOMContentLoaded', async () => {
  loadYouTubeAPI();
  loadTheme();
  loadCardsFromLocal();
  initParticles();
  initNavigation();
  initLangToggle();
  initAddForm();
  initReview();
  initLibrary();
  initModal();
  initSettings();
  initAudioActions();
  initSmartInput();
  updateDateDisplay();

  // Apply language context to start
  updateLanguageContextText();
  renderLangFilterBars();
  updateDashboard();
  updateCategoryDatalist();

  // Try to connect to Notion Proxy
  if (getNotionProxyUrl()) {
    await syncFromNotion();
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

      // ── 以資料庫為主（Source of Truth）全數覆寫本地端 ──
      const realNotionCards = notionCards.filter(c => c.id !== STREAK_CARD_ID);
      cards = [...realNotionCards];
      saveCardsToLocal();
    } else if (cards.length > 0) {
      // Database is empty but local has data — push local to Database
      await NotionAPI.syncAll(cards);
    }
    updateSyncStatus('connected');
    updateDashboard();
  } catch (e) {
    console.warn('Database sync failed:', e);
    updateSyncStatus('error');
  }
}

async function saveCardToNotion(card) {
  if (!getNotionProxyUrl()) return;
  try {
    updateSyncStatus('syncing');
    await NotionAPI.saveCard(card);
    updateSyncStatus('connected');
  } catch (e) {
    console.warn('Save to Database failed:', e);
    updateSyncStatus('error');
    showToast('⚠️ 儲存失敗: ' + (e.message || String(e)).substring(0, 50));
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
  if (dbTitle) dbTitle.textContent = `歡迎回來 ✨ - ${langLabel}學習`;
  if (rvTitle) rvTitle.textContent = `複習卡片 📖 - ${langLabel}`;
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
  // Always exclude the hidden streak meta-card from display lists
  const visible = cards.filter(c => c.id !== STREAK_CARD_ID);
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

// 初始化語言選單的自訂輸入切換邏輯
function initLangSelectCustom(selectId) {
  const sel = $(`#${selectId}`);
  const custom = $(`#${selectId}Custom`);
  if (!sel || !custom) return;
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
    utterance.onend = () => btnElement.classList.remove('speaking');
    utterance.onerror = (e) => {
      // Chrome sometimes fires 'canceled' falsely during start or immediately after cancel
      if (e.error !== 'canceled') {
        console.error("[TTS] Playback Error:", e);
      }
      btnElement.classList.remove('speaking');
    };
  }

  // Play: use a delay if we had to cancel first, otherwise play immediately
  const delay = wasSpeaking ? 200 : 0;
  setTimeout(() => {
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
  // ⚠️ Use UTC so all devices (regardless of timezone) compare against the same midnight
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
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

  // Animate stat numbers
  animateNumbers();

  // Schedule timeline
  renderSchedule(activeCards);
}

function animateNumbers() {
  $$('.stat-number').forEach(el => {
    const target = parseInt(el.textContent);
    let current = 0;
    const increment = Math.max(1, Math.ceil(target / 20));
    const interval = setInterval(() => {
      current += increment;
      if (current >= target) {
        el.textContent = target;
        clearInterval(interval);
      } else {
        el.textContent = current;
      }
    }, 30);
  });
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

// ── Add Form ──
function initAddForm() {
  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();

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
    _addImageUrl = ''; // reset after use

    cards.push(newCard);
    saveCardsToLocal();

    // Reset form
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
    updateCategoryDatalist();

    // Show toast
    showToast(`「${word}」已成功加入知識庫！`);

    // Decouple network request from form submit lifecycle to prevent iOS Safari cancellation
    setTimeout(() => {
      saveCardToNotion(newCard);
    }, 100);
  });
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
function initLibrary() {
  $('#searchInput').addEventListener('input', renderLibrary);
  $('#filterCategory').addEventListener('input', renderLibrary);
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

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" id="emptyLibrary" style="grid-column: 1 / -1;">
        <div class="empty-icon">${activeCards.length === 0 ? '📭' : '🔍'}</div>
        <h3>${activeCards.length === 0 ? '此語言的知識庫是空的' : '找不到結果'}</h3>
        <p>${activeCards.length === 0 ? '開始新增字句來建立你的學習庫吧！' : '試試其他搜尋關鍵字'}</p>
      </div>`;
    return;
  }

  const levelNames = ['新學', '初學', '學習中', '熟悉中', '進階', '精通', '大師'];

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
        ${card.example ? `<div class="library-card-example">${escapeHtml(card.example)}</div>` : ''}
        <div class="library-card-footer">
          ${card.category ? `<span class="library-card-tag">${escapeHtml(card.category)}</span>` : '<span></span>'}
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span class="library-card-level ${levelClass}">${levelText}</span>
            <span class="library-card-next">📅 ${nextReview}</span>
          </div>
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
  if (imgStatusEl) { imgStatusEl.style.display = 'none'; imgStatusEl.textContent = _editImageUrl ? '✅ 已有圖片' : ''; }
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
  const datalist = $('#filterCategoryList');
  if (!datalist) return;

  const allTags = [];
  activeCards.forEach(c => {
    if (c.category) {
      c.category.split(',').forEach(tag => allTags.push(tag.trim()));
    }
  });
  const categories = [...new Set(allTags)].filter(Boolean).sort();

  datalist.innerHTML = categories.map(cat => `<option value="${escapeHtml(cat)}">`).join('');
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
  const urlInput = $('#sheetUrlInput');

  // Load saved URL
  urlInput.value = getNotionProxyUrl();

  // Open settings
  $('#settingsBtn').addEventListener('click', () => {
    urlInput.value = getNotionProxyUrl();
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
    applyTheme(preset);
    showToast('已套用「深遂紫」配色');
  });

  $('#presetMidnightBlue')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#14213d', accentPrimary: '#fca311' };
    applyTheme(preset);
    showToast('已套用「深夜藍」配色');
  });

  $('#presetVibrantYellow')?.addEventListener('click', () => {
    const preset = {
      bgPrimary: '#f5c400', accentPrimary: '#555555',
      textPrimary: '#333333', textSecondary: '#555555', textMuted: '#777777',
      bgGlass: 'rgba(0,0,0,0.06)', borderLight: 'rgba(0,0,0,0.12)'
    };
    applyTheme(preset);
    showToast('已套用「活力黃」配色');
  });

  $('#presetGreenBrown')?.addEventListener('click', () => {
    const preset = { bgPrimary: '#3a3207', accentPrimary: '#babd8d' };
    applyTheme(preset);
    showToast('已套用「綠野棕」配色');
  });

  // Theme Reset
  $('#resetThemeBtn').addEventListener('click', () => {
    localStorage.removeItem('crystal_learning_theme');
    applyTheme({});
    showToast('已還原為預設配色');
  });

  // Save
  $('#saveSettings').addEventListener('click', () => {
    const url = urlInput.value.trim();
    setNotionProxyUrl(url);

    // Save Theme Configuration
    const currentTheme = {
      bgPrimary: $('#colorBgPrimary').value !== '#0a0a1a' ? $('#colorBgPrimary').value : '',
      accentPrimary: $('#colorAccent').value !== '#6366f1' ? $('#colorAccent').value : '',
    };
    saveTheme(currentTheme);

    modal.classList.remove('active');

    if (url) {
      showToast('設定已儲存，正在連線...');
      syncFromNotion();
    } else {
      updateSyncStatus('offline');
      showToast('已清除資料庫連線');
    }
  });

  // Sync now
  $('#syncNowBtn').addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showToast('⚠️ 未設定資料庫網址，無法上傳');
      return;
    }
    setNotionProxyUrl(url);
    modal.classList.remove('active');
    showLoading('正在同步資料到 Database...');

    try {
      updateSyncStatus('syncing');
      await NotionAPI.syncAll(cards);
      updateSyncStatus('connected');
      showToast(`已成功同步 ${cards.length} 張卡片到 Notion`);
    } catch (e) {
      console.error('Sync failed:', e);
      updateSyncStatus('error');
      showToast('同步失敗，請檢查 URL 是否正確');
    } finally {
      hideLoading();
    }
  });

  // Click sync status to open settings
  $('#syncStatusBtn').addEventListener('click', () => {
    urlInput.value = getNotionProxyUrl();
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
      if (btnElement) btnElement.classList.add('speaking');
      const audio = new Audio(card.audioUrl);
      audio.onended = () => { if (btnElement) btnElement.classList.remove('speaking'); };
      audio.onerror = () => {
        if (btnElement) btnElement.classList.remove('speaking');
        if (langCode) speakText(defaultText, langCode, btnElement);
      };
      audio.play().catch(e => {
        if (btnElement) btnElement.classList.remove('speaking');
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
  statusEl.textContent = '⏳ 上傳中，請稍候...';
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
    statusEl.textContent = `✅ 音檔上傳成功！(${lang || 'other'})`;
    showToast('音檔上傳成功！');
  } catch (e) {
    console.error('Audio upload failed:', e);
    statusEl.className = 'audio-status error';
    statusEl.textContent = '❌ 上傳失敗：' + e.message;
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
          recordBtn.textContent = '🎙️ 錄音';
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
          statusEl.className = 'audio-status';
          statusEl.textContent = '🔴 錄音中...';
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

// Returns a Promise that resolves with a ready Audio object, or rejects on error/timeout
function tryLoadAudio(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const timer = setTimeout(() => {
      audio.src = '';
      reject(new Error('timeout'));
    }, timeoutMs);
    audio.addEventListener('canplay', () => { clearTimeout(timer); resolve(audio); });
    audio.addEventListener('error', () => { clearTimeout(timer); reject(audio.error || new Error('error')); });
    audio.src = url;
    audio.load();
  });
}

async function playGoogleDriveAudio(url, btnElement, onErrorCallback) {
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!fileIdMatch) {
    playDirectAudio(url, btnElement, onErrorCallback);
    return;
  }

  const fileId = fileIdMatch[1];

  if (btnElement) btnElement.classList.add('speaking');
  if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }

  // Try multiple Drive URL formats in order:
  const candidates = [
    `https://docs.google.com/uc?export=download&id=${fileId}`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
  ];

  for (const candidate of candidates) {
    try {
      const audio = await tryLoadAudio(candidate, 5000);
      currentAudio = audio;
      audio.addEventListener('ended', () => {
        if (btnElement) btnElement.classList.remove('speaking');
      });
      audio.addEventListener('error', () => {
        if (btnElement) btnElement.classList.remove('speaking');
        if (onErrorCallback) onErrorCallback();
      });
      await audio.play();
      return; // Success
    } catch (err) {
      console.warn(`Failed to play ${candidate}:`, err);
      // This candidate failed, try the next one
    }
  }

  // All candidates failed. 
  if (btnElement) btnElement.classList.remove('speaking');
  showToast('Google Drive 阻擋了直接播放，為您開啟新分頁聆聽！');

  // As a last fallback, open it in a new tab so they can at least hear it
  window.open(url, '_blank');
}

function playDirectAudio(url, btnElement, onErrorCallback) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  if (btnElement) btnElement.classList.add('speaking');

  currentAudio = new Audio(url);

  currentAudio.addEventListener('ended', () => {
    if (btnElement) btnElement.classList.remove('speaking');
  });

  currentAudio.addEventListener('error', (e) => {
    console.warn("Failed to play custom audio:", e);
    if (btnElement) btnElement.classList.remove('speaking');
    if (onErrorCallback) onErrorCallback();
  });

  currentAudio.play().catch(e => {
    console.warn("Audio play blocked or failed:", e);
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
  statusEl.textContent = '⏳ 翻譯中...';
  statusEl.className = 'audio-status uploading';

  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${from}|${to}`
    );
    const data = await res.json();
    const translated = data?.responseData?.translatedText;

    if (translated && translated !== word) {
      $('#inputMeaning').value = translated;
      statusEl.textContent = `✅ 翻譯成功！`;
      statusEl.className = 'audio-status success';
    } else {
      statusEl.textContent = '❌ 無法翻譯，請手動填寫';
      statusEl.className = 'audio-status error';
    }
  } catch (e) {
    statusEl.textContent = '❌ 翻譯服務無法連線';
    statusEl.className = 'audio-status error';
  }
}

async function runOCR(imageFile, lang) {
  const overlay = $('#ocrOverlay');
  const wordList = $('#ocrWordList');
  const fullText = $('#ocrFullText');
  const confirmBtn = $('#ocrConfirmBtn');
  let selectedWords = new Set();

  overlay.style.display = 'flex';
  wordList.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">🔍 傳送至 Google Vision 辨識中...</span>';
  fullText.textContent = '';
  confirmBtn.textContent = '✅ 確認填入（0 個字詞）';
  confirmBtn.disabled = true;

  const syncConfirmBtn = () => {
    const n = selectedWords.size;
    confirmBtn.disabled = n === 0;
    confirmBtn.textContent = `✅ 確認填入（${n} 個字詞）`;
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
    wordList.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">🖼️ 壓縮圖片中...</span>';
    const compressed = await compressImage(imageFile, 800); // 800KB safe margin
    if (!compressed) throw new Error('圖片壓縮失敗');

    wordList.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">🔍 Google Vision 辨識中...</span>';

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
    wordList.innerHTML = `<span style="color:var(--text-muted);font-size:0.85rem">⚠️ ${e.message || '辨識失敗，請重試'}</span>`;
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
    statusEl.textContent = '⏳ 處理圖片中...';
  }
  const compressed = await compressImage(file, 50);
  if (!compressed) {
    if (statusEl) {
      statusEl.className = 'audio-status error';
      statusEl.textContent = '❌ 圖片處理失敗';
    }
    return null;
  }
  if (statusEl) {
    statusEl.className = 'audio-status uploading';
    statusEl.textContent = '⏳ 上傳中，請稍候...';
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
        statusEl.textContent = '✅ 圖片上傳成功！';
      }
      return json.url;
    }
    if (statusEl) {
      statusEl.className = 'audio-status error';
      statusEl.textContent = '❌ 上傳失敗：' + (json.error || '');
    }
    return null;
  } catch (e) {
    if (statusEl) {
      statusEl.className = 'audio-status error';
      statusEl.textContent = '❌ 上傳失敗';
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
      const origFill = (text) => { $('#editMeaning').value = text; };
      // 借用 autoTranslate，但 target 是 editMeaning
      editTranslateStatus.style.display = 'block';
      editTranslateStatus.textContent = '⏳ 翻譯中...';
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
          editTranslateStatus.textContent = '✅ 翻譯成功！';
          editTranslateStatus.className = 'audio-status success';
        } else {
          editTranslateStatus.textContent = '❌ 無法翻譯，請手動填寫';
          editTranslateStatus.className = 'audio-status error';
        }
      } catch (e) {
        editTranslateStatus.textContent = '❌ 翻譯服務無法連線';
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
