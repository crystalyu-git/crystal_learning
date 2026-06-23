# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Crystal Learning** is a spaced repetition flashcard web app for language learning. It is a **vanilla JavaScript SPA** with no build tools, no npm, and no framework dependencies. Open `index.html` directly in a browser to run it.

## Running the App

No build step required. Open `index.html` in a browser. For backend sync features, deploy one of the two backend scripts to Google Apps Script and configure the proxy URL in Settings.

## Architecture

### File Structure

| File | Purpose |
|------|---------|
| `index.html` | All HTML views (Dashboard, Add, Review, Library, Settings) |
| `app.js` | All frontend logic (~2400 lines, single file) |
| `styles.css` | CSS with custom property theming, glassmorphism dark theme |
| `google_apps_script.js` | Google Apps Script backend using Google Sheets + Drive |
| `notion_proxy_script.js` | Alternative backend using Notion API |

### Frontend (app.js)

Single-file vanilla JS. Key responsibilities:

- **State**: `cards[]` (all cards), `reviewQueue[]` (current session), stored in `localStorage`
- **Views**: SPA routing via `switchView()` — Dashboard, Add, Review, Library, Settings
- **Sync**: `syncFromNotion()` — bidirectional sync with either backend; cloud is source of truth on conflict
- **Spaced repetition**: Intervals `[0, 1, 2, 4, 7, 15, 30]` days, 7 levels; `handleRating()` updates `level` and `nextReview`
- **Theme**: CSS custom properties injected via `applyTheme()`; persisted in localStorage
- **Audio**: Web Speech API for TTS; audio files uploaded to Google Drive and streamed back
- **OCR**: Images uploaded to backend which calls Google Cloud Vision API

### Backend Scripts (Google Apps Script)

Both backends expose `doGet()` / `doPost()` HTTP endpoints for CRUD operations on cards, file uploads to Google Drive, and OCR. They are deployed as standalone Web Apps in Google Apps Script. The proxy URL is configured by the user in Settings.

### Card Data Schema

```javascript
{
  id, word, pronunciation, meaning, example,
  category,      // comma-separated tags
  audioUrl,      // Google Drive share link
  imageUrl,
  lang,          // e.g. "en-US", "zh-TW"
  level,         // 0–6 (spaced repetition level)
  nextReview,    // Unix timestamp (ms)
  createdAt,     // Unix timestamp (ms)
  reviewCount
}
```

Streak data is stored as a hidden card with `id: "__crystal_streak__"` in the cloud backend.

### Supported Languages

English, Chinese, Japanese, Korean, French, German, Spanish, Italian, Portuguese, Thai, Vietnamese.

## Key Patterns

- **Offline-first**: All data lives in `localStorage`; cloud sync is optional
- **Dual backend**: `notion_proxy_script.js` and `google_apps_script.js` are functionally equivalent; selected by proxy URL
- **No frameworks**: Pure DOM manipulation, no React/Vue/etc.
- **Comments are in Traditional Chinese** — this is intentional
