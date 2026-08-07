# 🤖 AI Social Media Operator (v1.1.0)

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/rasyiqi-code/AISocialMediaOperator/releases/tag/v1.1.0)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Manifest](https://img.shields.io/badge/manifest-v3-orange.svg)](manifest.json)
[![Platform](https://img.shields.io/badge/platforms-Threads%20%7C%20Facebook%20%7C%20X--Twitter-brightgreen.svg)]()

**AI Social Media Operator** is a powerful Chrome Extension (Manifest V3) browser agent that automates content generation, engagement, and organic social media interactions across **X (Twitter)**, **Facebook**, and **Threads** using state-of-the-art AI engines (Gemini, OpenAI, Groq).

---

## ✨ Key Features

### 🌐 Automatic Target Language Matching
The AI automatically detects the primary language of any target post or tweet (English, Indonesian, Spanish, Japanese, German, etc.) and responds in the **exact same language**, using natural tone and authentic local slang.

---

### 𝕏 X (Twitter) Automation Suite
* **💬 Direct Status AI-Reply**: Navigates directly to tweet status pages (`/status/...`) to post clean, highly engaging AI replies without pop-up modal triggers.
* **🗣️ Auto AI-Quote Tweet**: Automated Quote Tweet creation with smart AI commentary.
* **❤️ Auto-Like Tweet**: Automatically likes tweets while scrolling through the home timeline.
* **🔁 Auto-Retweet**: Reposts target tweets to your timeline.
* **➕ Universal Auto-Follow**: Scans and follows target user accounts across feed articles, header cards, search results, and recommendations.
* **📜 Smart Reload & Auto-Scroll**: Reloads `https://x.com/home` cleanly after interactions and performs smooth initial 600px scrolling to continuously discover fresh tweets.

---

### 📘 Facebook Automation Suite
* **💬 Contextual Feed Auto AI-Comment**: Reads Facebook feed posts and generates contextual comments.
* **👍 Auto-Like / Random Reactions**: Reacts with random organic reactions (Like, Love, Care, Haha, Wow).
* **🔁 Auto-Share / Repost**: Shares feed posts to your profile/page.
* **➕ Auto-Follow / Friend Request**: Automated user/page follow interactions.
* **📖 Auto-View Story**: Continuously watches Facebook Stories.
* **👥 Personal Friend Interactions**: Visits friend profiles from your Friends list to react and leave warm AI comments.

---

### 🧵 Threads Automation Suite
* **💬 Auto AI-Reply**: Contextual AI replies on Threads posts.
* **❤️ Auto-Like**, **🔁 Auto-Repost**, **➕ Auto-Follow**.

---

### 🛡️ Tab-Scoped Session Security
Automation loops are locked to tab-scoped `sessionStorage`. Opening social media pages or refreshing tabs will **never** trigger unwanted automatic execution. Automation only runs when explicitly started via the Extension Sidepanel.

---

## 🛠️ Installation & Setup

1. **Clone Repository**:
   ```bash
   git clone https://github.com/rasyiqi-code/AISocialMediaOperator.git
   cd AISocialMediaOperator
   ```

2. **Install Dependencies & Build**:
   ```bash
   npm install
   npm run build
   ```

3. **Load in Chrome / Brave / Edge**:
   - Open Chrome and navigate to `chrome://extensions/`.
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked**.
   - Select the `AISocialMediaOperator` root directory.

4. **Configure AI API Key**:
   - Click the extension icon to open the **Sidepanel**.
   - Navigate to **Settings** (Pengaturan AI).
   - Choose your preferred provider (**Google Gemini**, **OpenAI ChatGPT**, or **Groq**).
   - Enter your API Key and click **Save**.

---

## 📁 Project Structure

```
AISocialMediaOperator/
├── manifest.json            # Extension Manifest V3 configuration
├── package.json             # Build scripts & dependencies
├── public/                  # Bundled assets & sidepanel UI
│   ├── content_main.bundle.js
│   ├── background.bundle.js
│   ├── sidepanel.html
│   └── icons/
└── src/
    ├── background/          # Extension Background Service Worker
    ├── content/             # DOM adapters & content scripts
    │   ├── adapters/        # Platform-specific adapters (X, FB, Threads)
    │   └── content_main.js
    ├── services/            # AI Engine integration (Gemini, OpenAI, Groq)
    ├── sidepanel/           # Extension Sidepanel UI & controls
    └── utils/               # DOM typing, caret, & storage helpers
```

---

## 💻 Development Commands

* **Build Production Bundle**:
  ```bash
  npm run build
  ```
* **Watch Mode (Development)**:
  ```bash
  npm run watch
  ```

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
