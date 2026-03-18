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
