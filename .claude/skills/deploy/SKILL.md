---
name: deploy
description: 當使用者說「上版」、「部署」、「deploy」、「push 到 GitHub」、「發布」、「上線」時，使用此 skill 執行完整的上版流程。
version: 1.0.0
---

# 上版流程 (GitHub Pages Deploy)

此 skill 負責將 crystal_learning 的變更發布到 GitHub Pages。

## 觸發時機

當使用者說以下任一內容時啟用：
- 上版、部署、發布、上線
- deploy、push、release
- 推到 GitHub、更新網站

## 上版步驟

執行以下流程，所有步驟在同一次回應中完成：

1. **確認變更**：執行 `git status` 了解目前狀態
2. **Stage 所有變更**：執行 `git add -A`
3. **建立 commit**：
   - 根據實際改動撰寫繁體中文 commit message
   - 格式：`[類型] 簡短說明`（類型：新增／修正／更新／優化）
   - 執行 `git commit -m "..."`
4. **Push 到 GitHub**：執行 `git push origin master`

## 注意事項

- Commit message 使用繁體中文
- 若無任何變更（clean working tree），告知使用者不需要上版
- Push 成功後，告知使用者 GitHub Pages 將在幾分鐘內更新
- 網址：https://crystalyu-git.github.io/crystal_learning/
