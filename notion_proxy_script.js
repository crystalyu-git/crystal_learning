// =============================================
// Crystal Learning - Notion API Proxy (Google Apps Script)
// 將此程式碼貼到 Google Sheets 的 Apps Script 中
// =============================================
//
// 📋 設定步驟：
// 1. 到 Notion 建立一個新的 Database (Inline 或 Full page)，並包含以下屬性：
//    - id (Text)
//    - word (Title - 這是必要的名稱欄位)
//    - pronunciation (Text)
//    - meaning (Text)
//    - example (Text)
//    - category (Select 或 Text)
//    - audioUrl (Text)
//    - lang (Select 或 Text)
//    - level (Number)
//    - nextReview (Number)
//    - createdAt (Number)
//    - reviewCount (Number)
//
// 2. 到 Notion Integrations (https://www.notion.so/my-integrations) 建立一個新的 Integration，取得 "Internal Integration Secret" (Token)。
// 3. 回到您的 Notion Database，點選右上角的 `...` -> `Connections` -> 搜尋並加入您剛剛建立的 Integration。
// 4. 取得 Database ID：打開您的 Database 網頁（不要選特定的列），網址結構類似 `https://www.notion.so/WORKSPACE_NAME/DATABASE_ID?v=...`。`DATABASE_ID` 是一串 32 字元的英數字。
//
// 5. 在 Google Drive 隨便新增一個 Google Script (或打開現有的 Apps Script 專案)。
// 6. 刪除預設程式碼，貼上此檔案的全部內容。
// 7. 將下方的 `NOTION_TOKEN` 和 `DATABASE_ID` 替換為您的真實資料。
// 8. 點選 Deploy → New deployment
//    - 類型選 "Web app"
//    - Execute as: "Me"
//    - Who has access: "Anyone"
// 9. 點選 Deploy，複製產生的 Web App URL。
// 10. 將 URL 貼到 Crystal Learning 網站的設定中即可！
// =============================================

const NOTION_TOKEN = 'secret_請換成您的_Notion_Token';
const DATABASE_ID = '請換成您的_Database_ID';
const NOTION_API_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

// 定義欄位與 Notion 屬性型態的對應表
const PROPERTY_TYPES = {
    id: 'rich_text',
    word: 'title',
    pronunciation: 'rich_text',
    meaning: 'rich_text',
    example: 'rich_text',
    category: 'rich_text',  // multi-tag support (comma-separated)
    audioUrl: 'url',
    imageUrl: 'url',        // card image
    lang: 'select',
    level: 'number',
    nextReview: 'number',
    createdAt: 'number',
    reviewCount: 'number'
};

// 處理 CORS Preflight 請求
function doOptions(e) {
    return HtmlService.createHtmlOutput(' ')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 處理 GET 請求 — 讀取所有卡片
function doGet(e) {
    try {
        const cards = queryAllNotionPages();
        return jsonResponse({ success: true, cards: cards });
    } catch (error) {
        return jsonResponse({ success: false, error: 'GET Error: ' + error.toString() });
    }
}

// 處理 POST 請求 — 儲存、刪除、批次同步
function doPost(e) {
    try {
        const body = JSON.parse(e.postData.contents);
        const action = body.action;

        switch (action) {
            case 'save':
                return saveCard(body.card);
            case 'delete':
                return deleteCard(body.id);
            case 'sync':
                return syncAll(body.cards);
            case 'uploadAudio':
                return uploadAudio(body.base64Data, body.filename, body.mimeType, body.lang);
            case 'uploadImage':
                return uploadImage(body.base64Data, body.filename, body.mimeType, body.lang);
            case 'deleteAudio':
                return deleteAudio(body.fileId);
            case 'ocrImage':
                return performOCR(body.base64Data, body.mimeType);
            default:
                return jsonResponse({ success: false, error: 'Unknown action: ' + action });
        }
    } catch (error) {
        return jsonResponse({ success: false, error: 'POST Error: ' + error.toString() });
    }
}

// -------------------------------------------------------------
// Core Notion API Functions
// -------------------------------------------------------------

function getFetchOptions(method, payload = null) {
    const options = {
        method: method,
        headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json'
        },
        muteHttpExceptions: true
    };
    if (payload) {
        options.payload = JSON.stringify(payload);
    }
    return options;
}

// 查詢所有頁面，處理分頁 (Pagination)
function queryAllNotionPages() {
    let cards = [];
    let hasMore = true;
    let nextCursor = undefined;

    const url = `${NOTION_API_BASE}/databases/${DATABASE_ID}/query`;

    while (hasMore) {
        const payload = {};
        if (nextCursor) {
            payload.start_cursor = nextCursor;
        }

        // 為了效能，我們不需要太詳細的 block 內容，只要 property 即可
        const response = UrlFetchApp.fetch(url, getFetchOptions('post', payload));
        const json = JSON.parse(response.getContentText());

        if (response.getResponseCode() !== 200) {
            throw new Error(`Notion API Error: ${json.message}`);
        }

        // 將 Notion 的 page object 轉換為我們的 card object
        json.results.forEach(page => {
            cards.push(parseNotionPageToCard(page));
        });

        hasMore = json.has_more;
        nextCursor = json.next_cursor;
    }

    return cards;
}

// 尋找特定的卡片 (By App Card ID)
function findNotionPageIdByCardId(appCardId) {
    const url = `${NOTION_API_BASE}/databases/${DATABASE_ID}/query`;
    const payload = {
        filter: {
            property: 'id',
            rich_text: {
                equals: appCardId
            }
        },
        page_size: 1
    };

    const response = UrlFetchApp.fetch(url, getFetchOptions('post', payload));
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() === 200 && json.results.length > 0) {
        return json.results[0].id; // 這是 Notion 內部的 Page ID
    }
    return null;
}

// 儲存/更新單張卡片
function saveCard(card) {
    // 1. 先確認這張卡片是否已經存在於 Notion
    const existingPageId = findNotionPageIdByCardId(card.id);
    const properties = buildNotionProperties(card);

    if (existingPageId) {
        // 已經存在，執行 Update (Patch)
        const url = `${NOTION_API_BASE}/pages/${existingPageId}`;
        const payload = { properties: properties };
        const response = UrlFetchApp.fetch(url, getFetchOptions('patch', payload));

        if (response.getResponseCode() !== 200) {
            const err = JSON.parse(response.getContentText());
            throw new Error(`Update failed: ${err.message}`);
        }
    } else {
        // 不存在，執行 Create (Post)
        const url = `${NOTION_API_BASE}/pages`;
        const payload = {
            parent: { database_id: DATABASE_ID },
            properties: properties
        };
        const response = UrlFetchApp.fetch(url, getFetchOptions('post', payload));

        if (response.getResponseCode() !== 200) {
            const err = JSON.parse(response.getContentText());
            throw new Error(`Create failed: ${err.message}`);
        }
    }

    return jsonResponse({ success: true });
}

// 刪除卡片
function deleteCard(appCardId) {
    const existingPageId = findNotionPageIdByCardId(appCardId);
    if (existingPageId) {
        // Notion API 的刪除其實是把它移到回收桶 (Archive)
        const url = `${NOTION_API_BASE}/pages/${existingPageId}`;
        const payload = { archived: true };
        const response = UrlFetchApp.fetch(url, getFetchOptions('patch', payload));

        if (response.getResponseCode() !== 200) {
            const err = JSON.parse(response.getContentText());
            throw new Error(`Delete failed: ${err.message}`);
        }
    }
    return jsonResponse({ success: true });
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

// ── Google Cloud Vision OCR ──
// 前提：在 Google Cloud Console 中為本 Apps Script 的 GCP 專案啟用 "Cloud Vision API"
// (Apps Script → 左側「專案設定」 → 取得 GCP 專案編號 → 到 Cloud Console 啟用 API)
function performOCR(base64Data, mimeType) {
    try {
        const token = ScriptApp.getOAuthToken();
        const apiUrl = 'https://vision.googleapis.com/v1/images:annotate';

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
            headers: { 'Authorization': 'Bearer ' + token },
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

        // fullTextAnnotation gives cleanest result with line breaks preserved
        const fullText = annotations.fullTextAnnotation?.text || annotations.textAnnotations?.[0]?.description || '';

        // Extract individual words/tokens from each block/paragraph/word
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

// 批次同步所有卡片（因為 Notion API 限制，我們只能逐條處理，這可能會花很多時間並遇到 Rate Limit）
function syncAll(cards) {
    if (!cards || cards.length === 0) {
        return jsonResponse({ success: true, count: 0 });
    }

    // 為了避免 Apps Script timeout，如果是大量同步，這是一個非常簡單且暴力的解法：
    // 理想中我們應該對比差異，這裡簡單示範逐一存檔 (這在卡片超過上百張時極易超時，這也是為何 Notion 不太適合無腦 full sync)
    // 建議前端設計為：平時只有 Save/Delete 單筆，少用 Full Sync

    let successCount = 0;
    let errors = [];

    for (let i = 0; i < cards.length; i++) {
        try {
            // 簡單的休眠防止撞上 Notion rate limit (3 requests per second)
            if (i > 0 && i % 3 === 0) {
                Utilities.sleep(1000);
            }
            // 此處呼叫上面的函式
            const existingPageId = findNotionPageIdByCardId(cards[i].id);
            const properties = buildNotionProperties(cards[i]);

            if (existingPageId) {
                UrlFetchApp.fetch(`${NOTION_API_BASE}/pages/${existingPageId}`, getFetchOptions('patch', { properties: properties }));
            } else {
                UrlFetchApp.fetch(`${NOTION_API_BASE}/pages`, getFetchOptions('post', { parent: { database_id: DATABASE_ID }, properties: properties }));
            }
            successCount++;
        } catch (err) {
            errors.push(`Card ${cards[i].id}: ${err.message}`);
        }
    }

    if (errors.length > 0) {
        return jsonResponse({ success: true, count: successCount, warnings: errors });
    }
    return jsonResponse({ success: true, count: successCount });
}

// -------------------------------------------------------------
// Data Parser Helpers
// -------------------------------------------------------------

function parseNotionPageToCard(page) {
    const card = {};
    const props = page.properties;

    // 為了確保屬性存在，寫一個安全讀取函數
    const getText = (propName) => {
        if (props[propName] && props[propName].rich_text && props[propName].rich_text.length > 0) {
            return props[propName].rich_text.map(t => t.plain_text).join('');
        }
        return '';
    };

    const getTitle = (propName) => {
        if (props[propName] && props[propName].title && props[propName].title.length > 0) {
            return props[propName].title.map(t => t.plain_text).join('');
        }
        return '';
    };

    const getSelect = (propName) => {
        if (props[propName] && props[propName].select) {
            return props[propName].select.name;
        }
        // 如果使用者設定為 Text 屬性
        if (props[propName] && props[propName].type === 'rich_text') {
            return getText(propName);
        }
        return '';
    };

    const getNumber = (propName) => {
        if (props[propName] && typeof props[propName].number === 'number') {
            return props[propName].number;
        }
        return 0;
    };

    const getUrl = (propName) => {
        if (props[propName] && props[propName].url) {
            return props[propName].url;
        }
        // 如果使用者設定為 Text 屬性
        if (props[propName] && props[propName].type === 'rich_text') {
            return getText(propName);
        }
        return '';
    };

    // 映射到我們的 Card 結構
    card.id = getText('id');         // 我們將 id 存在 rich_text
    card.word = getTitle('word');    // word 必須是 title
    card.pronunciation = getText('pronunciation');
    card.meaning = getText('meaning');
    card.example = getText('example');
    card.category = getText('category');  // read from rich_text (new) or fallback to select (old)
    if (!card.category && props['category'] && props['category'].type === 'select' && props['category'].select) {
        card.category = props['category'].select.name || '';
    }
    card.audioUrl = getUrl('audioUrl');
    card.imageUrl = getUrl('imageUrl');
    card.lang = getSelect('lang');
    card.level = getNumber('level');
    card.nextReview = getNumber('nextReview');
    card.createdAt = getNumber('createdAt');
    card.reviewCount = getNumber('reviewCount');

    return card;
}

function buildNotionProperties(card) {
    const props = {};

    // 建立 rich_text 陣列
    const richText = (content) => [{ text: { content: content || '' } }];

    // 1. Title (word)
    props.word = { title: richText(String(card.word)) };

    // 2. Rich Texts
    props.id = { rich_text: richText(String(card.id)) };
    props.pronunciation = { rich_text: richText(card.pronunciation || '') };
    props.meaning = { rich_text: richText(card.meaning || '') };
    props.example = { rich_text: richText(card.example || '') };

    // 3. URLs — Notion 規格：清空 URL 屬性必須用 { url: null }，不能直接給 null
    props.audioUrl = card.audioUrl ? { url: card.audioUrl } : { url: null };
    props.imageUrl = card.imageUrl ? { url: card.imageUrl } : { url: null };

    // 4. Category — 儲存為 rich_text（支援逗號分隔的多標籤）
    props.category = { rich_text: [{ text: { content: card.category || '' } }] };

    // 5. Selects — lang 保持 select
    props.lang = card.lang ? { select: { name: card.lang } } : { select: null };

    // 6. Numbers
    props.level = { number: Number(card.level) || 0 };
    props.nextReview = { number: Number(card.nextReview) || 0 };
    props.createdAt = { number: Number(card.createdAt) || 0 };
    props.reviewCount = { number: Number(card.reviewCount) || 0 };

    return props;
}

// 輔助函式：JSON 回應
function jsonResponse(data) {
    return ContentService
        .createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}
