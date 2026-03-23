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

const SHEET_NAME = 'Sheet1'; // 你的工作表名稱，預設 Sheet1

// 取得工作表
function getSheet() {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

// 處理 GET 請求 — 讀取所有卡片
function doGet(e) {
    try {
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
            case 'deleteAudio':
                return deleteAudio(body.fileId);
            case 'performOCR':
                return performOCR(body.base64Data, body.mimeType);
            default:
                return jsonResponse({ success: false, error: 'Unknown action' });
        }
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
