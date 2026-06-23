---
name: add-theme
description: 新增色彩主題 preset 到 crystal_learning。當使用者說「新增主題」、「加主題」、「建立主題」、「新增色彩」並提供主題名稱與顏色時啟用。
version: 1.0.0
---

# 新增色彩主題

當使用者想新增一個色彩主題 preset 時，執行以下流程。

## 需要的資訊

在開始前確認使用者已提供：
- **主題名稱**（中文，例如「冰晶紫」）
- **背景色**（hex，例如 `#3d2c2e`）
- **主題色（accent）**（hex，例如 `#e1e5f2`）

若缺少任何資訊，直接向使用者詢問。

## 修改步驟

### 1. 讀取現有 preset 結構（定位插入點）

- 開啟 `index.html`，找到最後一個 `<button class="theme-preset-btn">` 的位置
- 開啟 `app.js`，找到最後一個 `$('#preset...')?.addEventListener` 的位置

### 2. 產生 preset ID

- 用英文 camelCase 命名，例如：「冰晶紫」→ `presetIceCrystalPurple`

### 3. 修改 index.html

在最後一個 preset button 後面插入：

```html
<button type="button" class="theme-preset-btn" id="preset{ID}"
    title="{主題名稱}：{背景色描述} + {主題色描述}"
    style="display:flex;align-items:center;gap:0.4rem;padding:0.35rem 0.75rem;border-radius:999px;border:1px solid var(--border-light);background:var(--bg-glass);color:var(--text-primary);font-size:0.8rem;cursor:pointer;">
    <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,{背景色},{主題色});flex-shrink:0;"></span>
    {主題名稱}
</button>
```

### 4. 修改 app.js

在 `initSettings()` 裡最後一個 preset 的 `addEventListener` 之後插入：

```javascript
$('#preset{ID}')?.addEventListener('click', () => {
  const preset = { bgPrimary: '{背景色}', accentPrimary: '{主題色}' };
  applyTheme(preset); saveTheme(preset);
  showToast('已套用「{主題名稱}」配色');
});
```

## 判斷是否為淺色主題

若背景色偏亮（luminance > 128），需在 preset 物件加入淺色文字設定：

```javascript
const preset = {
  bgPrimary: '{背景色}', accentPrimary: '{主題色}',
  textPrimary: '#555555', textSecondary: '#606060', textMuted: '#5a5a5a',
  bgGlass: 'rgba(0,0,0,0.06)', borderLight: 'rgba(0,0,0,0.12)'
};
```

判斷方式：`(R*299 + G*587 + B*114) / 1000 > 128` → 為淺色背景。

## 完成後

詢問使用者是否要上版（/deploy）。不要自動 commit 或 push。
