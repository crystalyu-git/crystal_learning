// =============================================
// Crystal Learning - Google Apps Script
// 將此程式碼貼到 Google Sheets 的 Apps Script 中
// =============================================
//
// 📋 設定步驟：
// 1. 建立新的 Google Sheet
// 2. 在第一列 (Row 1) 加入欄位標題：
//    A1: id | B1: word | C1: pronunciation | D1: meaning
//    E1: example | F1: category | G1: lang | H1: level
//    I1: nextReview | J1: createdAt | K1: reviewCount | L1: audioUrl
// 3. 點選 Extensions → Apps Script
// 4. 刪除預設程式碼，貼上此檔案的全部內容
// 5. 點選 Deploy → New deployment
//    - 類型選 "Web app"
//    - Execute as: "Me"
//    - Who has access: "Anyone"
// 6. 點選 Deploy，複製產生的 URL
// 7. 將 URL 貼到 Crystal Learning 的設定中
// =============================================

const SHEET_NAME = '字庫'; // 你的工作表名稱

// 取得工作表
function getSheet() {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

// 處理 GET 請求 — 讀取所有卡片；action=getAudio 時改回傳單一音檔的 base64
function doGet(e) {
    try {
        if (e && e.parameter && e.parameter.action === 'getAudio') {
            return getAudioBase64(e.parameter.fileId);
        }

        const sheet = getSheet();
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const rows = data.slice(1);

        const cards = rows
            .filter(row => row[0]) // 過濾空列
            .map(row => {
                const card = {};
                headers.forEach((header, index) => {
                    let value = row[index];
                    // 數字欄位轉型
                    if (['level', 'nextReview', 'createdAt', 'reviewCount'].includes(header)) {
                        value = Number(value) || 0;
                    }
                    card[header] = value;
                });
                return card;
            });

        return ContentService
            .createTextOutput(JSON.stringify({ success: true, cards: cards }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ success: false, error: error.message }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// 處理 POST 請求 — 儲存、刪除、批次同步、Telegram webhook
function doPost(e) {
    try {
        const body = JSON.parse(e.postData.contents);

        if (body.action) {
            switch (body.action) {
                case 'save':
                    return saveCard(body.card);
                case 'delete':
                    return deleteCard(body.id);
                case 'sync':
                    return syncAll(body.cards);
                case 'uploadAudio':
                    return uploadAudio(body.base64Data, body.filename, body.mimeType, body.lang);
                case 'deleteAudio':
                    return deleteAudio(body.fileId);
                case 'ocrImage':
                    return performOCR(body.base64Data, body.mimeType);
                case 'uploadImage':
                    return uploadImage(body.base64Data, body.filename, body.mimeType, body.lang);
                default:
                    return jsonResponse({ success: false, error: 'Unknown action' });
            }
        }

        // Telegram webhook 送來的 Update 物件：用 update_id 防止 Telegram 重試造成重複處理
        if (body.update_id !== undefined) {
            const cache = CacheService.getScriptCache();
            const updateKey = 'tg_update_' + body.update_id;
            if (cache.get(updateKey)) {
                return telegramResponse({ success: true, duplicate: true });
            }
            cache.put(updateKey, '1', 600); // 600 秒後自動過期
        }

        if (body.message) {
            return handleTelegramMessage(e, body.message);
        }

        if (body.callback_query) {
            return handleCallbackQuery(e, body.callback_query);
        }

        // 其他 Telegram update 類型（edited_message...）：忽略，但仍要用
        // telegramResponse() 回應，避免 ContentService 的 302 轉址問題
        return telegramResponse({ success: true, ignored: true });
    } catch (error) {
        return jsonResponse({ success: false, error: error.message });
    }
}

// 儲存/更新單張卡片
function saveCard(card) {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');

    // 尋找是否已存在
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
        if (data[i][idCol] === card.id) {
            rowIndex = i + 1; // Sheet rows are 1-indexed
            break;
        }
    }

    const rowData = headers.map(header => card[header] !== undefined ? card[header] : '');

    if (rowIndex > 0) {
        // 更新現有列
        sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowData]);
    } else {
        // 新增列
        sheet.appendRow(rowData);
    }

    return jsonResponse({ success: true });
}

// 刪除卡片
function deleteCard(id) {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');

    for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][idCol] === id) {
            sheet.deleteRow(i + 1);
            break;
        }
    }

    return jsonResponse({ success: true });
}

// 批次同步所有卡片（覆蓋式）
function syncAll(cards) {
    const sheet = getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // 清除資料列（保留標題列）
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1);
    }

    // 批次寫入
    if (cards && cards.length > 0) {
        const rows = cards.map(card =>
            headers.map(header => card[header] !== undefined ? card[header] : '')
        );
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    return jsonResponse({ success: true, count: cards ? cards.length : 0 });
}

// 輔助函式：JSON 回應
function jsonResponse(data) {
    return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

// =============================================================
// 以下為附加功能 (語音存檔至 Drive、使用 Google Cloud Vision 做 OCR)
// =============================================================

// 上傳音檔到 Google Drive
function uploadAudio(base64Data, filename, mimeType, lang) {
    try {
        const FOLDER_NAME = 'Crystal_Learning';

        // 找到或建立 Crystal_Learning 資料夾
        let rootFolder;
        const rootFolders = DriveApp.getFoldersByName(FOLDER_NAME);
        if (rootFolders.hasNext()) {
            rootFolder = rootFolders.next();
        } else {
            rootFolder = DriveApp.createFolder(FOLDER_NAME);
        }

        // 找到或建立語系子資料夾 (e.g. Crystal_Learning/ja-JP/)
        const subFolderName = lang || 'other';
        let subFolder;
        const subFolders = rootFolder.getFoldersByName(subFolderName);
        if (subFolders.hasNext()) {
            subFolder = subFolders.next();
        } else {
            subFolder = rootFolder.createFolder(subFolderName);
        }

        const decoded = Utilities.base64Decode(base64Data);
        const blob = Utilities.newBlob(decoded, mimeType || 'audio/webm', filename);

        // 存入語系子資料夾
        const file = subFolder.createFile(blob);

        // 設定分享權限為「知道連結的人可以查看」
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        const fileId = file.getId();
        const shareUrl = `https://drive.google.com/file/d/${fileId}/view`;

        return jsonResponse({ success: true, url: shareUrl, fileId: fileId });
    } catch (error) {
        return jsonResponse({ success: false, error: 'Upload error: ' + error.toString() });
    }
}

// 回傳 Drive 音檔的 base64
// iOS 加入主畫面（standalone）直連 Drive 播不出來，前端改抓 base64 轉 blob URL 播放
function getAudioBase64(fileId) {
    try {
        if (!fileId) return jsonResponse({ success: false, error: 'Missing fileId' });

        const file = DriveApp.getFileById(fileId);
        const MAX_BYTES = 20 * 1024 * 1024; // 太大會爆 Apps Script 執行限制
        if (file.getSize() > MAX_BYTES) {
            return jsonResponse({ success: false, error: 'File too large for base64 proxy' });
        }

        const blob = file.getBlob();
        return jsonResponse({
            success: true,
            mimeType: blob.getContentType() || 'audio/mpeg',
            base64: Utilities.base64Encode(blob.getBytes())
        });
    } catch (error) {
        return jsonResponse({ success: false, error: 'getAudio error: ' + error.toString() });
    }
}

// Google Drive 音檔刪除（只刪 Crystal_Learning 資料夾內的檔案）
function deleteAudio(fileId) {
    try {
        if (!fileId) return jsonResponse({ success: false, error: 'Missing fileId' });

        const file = DriveApp.getFileById(fileId);
        const parents = file.getParents();

        // 確認檔案在 Crystal_Learning 資料夾內（含子資料夾）
        let isOurs = false;
        while (parents.hasNext()) {
            const parent = parents.next();
            const grandParents = parent.getParents();
            const parentName = parent.getName();
            if (parentName === 'Crystal_Learning') {
                isOurs = true;
                break;
            }
            // 也確認父資料夾的父資料夾（語系子資料夾的情況）
            while (grandParents.hasNext()) {
                if (grandParents.next().getName() === 'Crystal_Learning') {
                    isOurs = true;
                    break;
                }
            }
            if (isOurs) break;
        }

        if (!isOurs) {
            return jsonResponse({ success: false, error: 'File is not in Crystal_Learning folder' });
        }

        file.setTrashed(true);
        return jsonResponse({ success: true });
    } catch (error) {
        return jsonResponse({ success: false, error: 'Delete error: ' + error.toString() });
    }
}

// 上傳圖片到 Google Drive /img/ 子目錄
function uploadImage(base64Data, filename, mimeType, lang) {
    try {
        const FOLDER_NAME = 'Crystal_Learning';
        const IMG_SUBFOLDER = 'img';

        let rootFolder;
        const rootFolders = DriveApp.getFoldersByName(FOLDER_NAME);
        rootFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(FOLDER_NAME);

        let imgFolder;
        const imgFolders = rootFolder.getFoldersByName(IMG_SUBFOLDER);
        imgFolder = imgFolders.hasNext() ? imgFolders.next() : rootFolder.createFolder(IMG_SUBFOLDER);

        const decoded = Utilities.base64Decode(base64Data);
        const blob = Utilities.newBlob(decoded, mimeType || 'image/jpeg', filename || 'image.jpg');
        const file = imgFolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        const fileId = file.getId();
        const shareUrl = `https://drive.google.com/file/d/${fileId}/view`;
        return jsonResponse({ success: true, url: shareUrl, fileId: fileId });
    } catch (error) {
        return jsonResponse({ success: false, error: 'Image upload error: ' + error.toString() });
    }
}

// ── Google Cloud Vision OCR ──
// Cloud Vision OCR — 使用 API Key（存在指令碼屬性 VISION_API_KEY）
// GCP Console → APIs & Services → Credentials → Create API Key → 限制為 Cloud Vision API
function performOCR(base64Data, mimeType) {
    try {
        const apiKey = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
        if (!apiKey) {
            return jsonResponse({ success: false, error: '請在 Apps Script 指令碼屬性中新增 VISION_API_KEY' });
        }

        const apiUrl = 'https://vision.googleapis.com/v1/images:annotate?key=' + apiKey;

        const requestBody = {
            requests: [{
                image: { content: base64Data },
                features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
                imageContext: { languageHints: ['ja', 'ko', 'zh-TW', 'zh-CN', 'en'] }
            }]
        };

        const response = UrlFetchApp.fetch(apiUrl, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(requestBody),
            muteHttpExceptions: true
        });

        const json = JSON.parse(response.getContentText());

        if (response.getResponseCode() !== 200) {
            return jsonResponse({ success: false, error: 'Vision API error: ' + (json.error?.message || response.getContentText()) });
        }

        const annotations = json.responses?.[0];
        if (!annotations || annotations.error) {
            return jsonResponse({ success: false, error: annotations?.error?.message || 'No text detected' });
        }

        const fullText = annotations.fullTextAnnotation?.text || annotations.textAnnotations?.[0]?.description || '';

        const words = [];
        const pages = annotations.fullTextAnnotation?.pages || [];
        pages.forEach(page => {
            (page.blocks || []).forEach(block => {
                (block.paragraphs || []).forEach(para => {
                    (para.words || []).forEach(wordObj => {
                        const word = (wordObj.symbols || []).map(s => s.text).join('');
                        if (word.trim()) words.push(word.trim());
                    });
                });
            });
        });

        return jsonResponse({ success: true, fullText: fullText.trim(), words: [...new Set(words)] });

    } catch (error) {
        return jsonResponse({ success: false, error: 'OCR error: ' + error.toString() });
    }
}

// =============================================================
// Telegram Webhook：轉發訊息自動寫入字庫
// 設定步驟：
// 1. Apps Script 編輯器 → 專案設定 → Script Properties 新增：
//    TELEGRAM_BOT_TOKEN、TELEGRAM_WEBHOOK_SECRET（自訂密鑰）、
//    WEB_APP_URL（目前部署的 Web App /exec 網址，留空則自動取用目前部署）
// 2. 重新部署（Manage deployments → Edit → New version）
// 3. 執行一次 setupTelegramWebhook() 註冊 webhook
// 4. 執行 checkTelegramWebhook() 確認註冊到的網址正確
// ※ 換成另一個部署（不同 /exec 網址）時，要更新 WEB_APP_URL 並重跑第 3、4 步
// =============================================================

// 處理 Telegram 傳來的訊息，解析固定格式後寫入字庫
function handleTelegramMessage(e, message) {
    const props = PropertiesService.getScriptProperties();
    const expectedSecret = props.getProperty('TELEGRAM_WEBHOOK_SECRET');
    if (!expectedSecret || e.parameter.telegramSecret !== expectedSecret) {
        return telegramResponse({ success: false, error: 'Unauthorized' });
    }

    const chatId = message.chat && message.chat.id;
    // 語音/圖片等媒體訊息的文字放在 caption 欄位，純文字訊息才用 text
    const rawText = message.text || message.caption || '';

    // 完全沒有文字內容的訊息（純貼圖等）直接忽略，不回覆
    if (!rawText) {
        return telegramResponse({ success: true, skipped: true });
    }

    const parsed = parseDailySentence(rawText);

    if (!parsed) {
        telegramReply(chatId, '⚠️ 格式不符，未寫入字庫。');
        return telegramResponse({ success: true, skipped: true });
    }

    const now = Date.now();
    const today = new Date();
    const card = {
        id: now.toString(36) + Math.random().toString(36).substr(2, 9),
        word: parsed.word,
        pronunciation: parsed.pronunciation,
        meaning: parsed.meaning,
        example: parsed.example,
        category: '每日一句',
        audioUrl: '',
        imageUrl: '',
        lang: 'ja-JP',
        level: 0,
        nextReview: new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime(),
        createdAt: now,
        reviewCount: 0,
    };

    // 訊息若附帶語音/音檔（例如發音檔），下載後存到 Drive，填入 audioUrl
    const audioUrl = saveTelegramAudioIfPresent(message, card.lang);
    if (audioUrl) card.audioUrl = audioUrl;

    saveCard(card);
    telegramReply(chatId, `✅ 已新增：${parsed.word}${audioUrl ? '（含發音檔）' : ''}`);
    return telegramResponse({ success: true });
}

// 若 Telegram 訊息附帶語音（voice）或音檔（audio），下載後上傳到 Google Drive，
// 回傳分享連結；沒有附帶或處理失敗則回傳 null（不影響卡片本身寫入）
function saveTelegramAudioIfPresent(message, lang) {
    const media = message.voice || message.audio;
    if (!media || !media.file_id) return null;

    try {
        const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
        const blob = downloadTelegramFile(media.file_id, token);
        const mimeType = media.mime_type || 'audio/ogg';
        const filename = media.file_name || `telegram_${Date.now()}.${(mimeType.split('/')[1] || 'ogg')}`;
        const base64Data = Utilities.base64Encode(blob.getBytes());

        const result = JSON.parse(uploadAudio(base64Data, filename, mimeType, lang).getContent());
        return result.success ? result.url : null;
    } catch (err) {
        return null;
    }
}

// 透過 Telegram Bot API 的 getFile 取得檔案路徑，再下載實際檔案內容
function downloadTelegramFile(fileId, token) {
    const infoRes = UrlFetchApp.fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
        { muteHttpExceptions: true }
    );
    const info = JSON.parse(infoRes.getContentText());
    if (!info.ok) throw new Error('getFile failed: ' + (info.description || ''));

    const fileUrl = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
    return UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true }).getBlob();
}

// Telegram webhook 專用回應：ContentService.createTextOutput() 對 Telegram 而言會觸發
// 302 轉址（"Wrong response from the webhook: 302 Moved Temporarily"），導致訊息一直重試。
// 改用 HtmlService 可避免這個轉址問題。其他既有功能（save/delete/sync...）維持用 jsonResponse()。
function telegramResponse(data) {
    return HtmlService.createHtmlOutput(JSON.stringify(data));
}

// 解析固定格式：📖...每日一句：開頭 + 🙌...🙌 結尾
function parseDailySentence(text) {
    if (!text) return null;
    const lines = text.split('\n').map(l => l.trim());

    const headerIdx = lines.findIndex(l => l.indexOf('📖') === 0 && l.indexOf('每日一句') !== -1);
    const footerIdx = lines.findIndex((l, i) =>
        i > headerIdx && l.indexOf('🙌') === 0 && l.lastIndexOf('🙌') > 0
    );
    if (headerIdx === -1 || footerIdx === -1 || footerIdx <= headerIdx) return null;

    // 依空行切成區塊：[0] = 中文/日文/假名/羅馬拼音，[1] = 文法筆記
    const blocks = [];
    let current = [];
    lines.slice(headerIdx + 1, footerIdx).forEach(line => {
        if (line === '') {
            if (current.length) { blocks.push(current); current = []; }
        } else {
            current.push(line);
        }
    });
    if (current.length) blocks.push(current);

    const sentenceBlock = blocks[0] || [];
    const meaning = sentenceBlock[0] || '';
    const word = sentenceBlock[1] || '';
    const pronunciation = sentenceBlock[2] || ''; // 假名讀音；羅馬拼音(index 3)捨棄不用
    const example = (blocks[1] || []).join('\n');

    if (!word || !meaning) return null;
    return { meaning, word, pronunciation, example };
}

// 回覆訊息給 Telegram 使用者
function telegramReply(chatId, text) {
    const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    if (!token || !chatId) return;
    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ chat_id: chatId, text: text }),
        muteHttpExceptions: true,
    });
}

// 一次性執行：註冊 webhook（在 Apps Script 編輯器手動執行一次即可）
function setupTelegramWebhook() {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('TELEGRAM_BOT_TOKEN');
    const secret = props.getProperty('TELEGRAM_WEBHOOK_SECRET');

    // 沒設 WEB_APP_URL 就用目前部署的網址，換部署後就不會忘了改屬性
    const webAppUrl = props.getProperty('WEB_APP_URL') || ScriptApp.getService().getUrl();
    if (!webAppUrl) throw new Error('找不到 Web App 網址：請設定 WEB_APP_URL 或先部署為 Web App');
    Logger.log('註冊到：' + webAppUrl);

    const hookUrl = `${webAppUrl}?telegramSecret=${encodeURIComponent(secret)}`;
    const apiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(hookUrl)}`;
    Logger.log(UrlFetchApp.fetch(apiUrl).getContentText());
}

// 確認 Telegram 目前實際打到哪個部署（換部署後用這個驗證有沒有搬成功）
function checkTelegramWebhook() {
    const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
    const res = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const info = JSON.parse(res.getContentText()).result || {};
    // 網址帶著密鑰，log 時遮掉
    Logger.log('目前 webhook：' + String(info.url || '(未設定)').replace(/telegramSecret=[^&]*/, 'telegramSecret=***'));
    Logger.log('待處理訊息數：' + info.pending_update_count);
    if (info.last_error_message) {
        Logger.log('最後一次錯誤：' + info.last_error_date + ' — ' + info.last_error_message);
    }
    return info;
}

// =============================================================
// 澆水/動一動提醒：同一個 bot 的另一個功能（inline keyboard 按鈕）
// 跟字庫轉發共用同一個 webhook，用 callback_query 分流過來
// =============================================================

const WATER_SHEET_ID = '1opxHnnqcMCtIaQAT4FUictX74pAb_QAQ-OpOssFIJZw';
const WATER_SHEET_NAME = '每日DoWhat';

// 處理「動動＋喝水」提醒訊息上的 Yes/No 按鈕
function handleCallbackQuery(e, callbackQuery) {
    const props = PropertiesService.getScriptProperties();
    const expectedSecret = props.getProperty('TELEGRAM_WEBHOOK_SECRET');
    if (!expectedSecret || e.parameter.telegramSecret !== expectedSecret) {
        return telegramResponse({ success: false, error: 'Unauthorized' });
    }

    const token = props.getProperty('TELEGRAM_BOT_TOKEN');
    const messageId = callbackQuery.message.message_id;
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    // 1. 讓按鈕停止轉圈
    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ callback_query_id: callbackQuery.id }),
        muteHttpExceptions: true,
    });

    // 2. 換掉訊息文字，按鈕消失
    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: data === 'yes' ? '✅ 已記錄take a break！' : '❌ 記得休息！',
        }),
        muteHttpExceptions: true,
    });

    // 3. 寫 Sheet（最慢，放最後）
    if (data === 'yes') {
        try {
            markWaterInSheet();
        } catch (err) {
            Logger.log('❌ sheet 寫入失敗: ' + err);
        }
    }

    return telegramResponse({ success: true });
}

function markWaterInSheet() {
    const ss = SpreadsheetApp.openById(WATER_SHEET_ID);
    const sheet = ss.getSheetByName(WATER_SHEET_NAME);

    const now = new Date();
    const day = Number(Utilities.formatDate(now, 'Asia/Taipei', 'd'));
    const timeStr = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm:ss');
    const markText = '● 動動＋喝水 ' + timeStr;

    const result = findDayCell(sheet, day);
    if (!result) {
        Logger.log('❌ 找不到今天的格子：' + day);
        return;
    }

    const cell = sheet.getRange(result.row, result.col);
    const existing = cell.getValue();
    cell.setValue(existing === '' ? markText : existing + '\n' + markText);

    Logger.log('✅ 寫入：' + cell.getValue());
}

function findDayCell(sheet, day) {
    const data = sheet.getDataRange().getValues();
    for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < data[r].length; c++) {
            const cellValue = data[r][c];
            // 儲存格若是日期格式會讀到 Date 物件，不是純數字，兩種都要能比對
            const cellDay = cellValue instanceof Date ? cellValue.getDate() : Number(cellValue);
            if (cellDay === day) {
                return { row: r + 2, col: c + 1 };
            }
        }
    }
    return null;
}

// 除錯用：手動在 Apps Script 編輯器執行，把非空白儲存格的實際值和型別印出來
// 確認完問題後可以刪掉這個函式
function debugWaterSheet() {
    const ss = SpreadsheetApp.openById(WATER_SHEET_ID);
    const sheet = ss.getSheetByName(WATER_SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    for (let r = 0; r < Math.min(10, data.length); r++) {
        for (let c = 0; c < data[r].length; c++) {
            const v = data[r][c];
            if (v !== '') {
                Logger.log(`[r=${r},c=${c}] value=${v} type=${typeof v} isDate=${v instanceof Date}`);
            }
        }
    }
}
