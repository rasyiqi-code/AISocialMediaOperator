/**
 * AI Provider Service Engine
 * Cookie-based (ChatGPT, Gemini) + OpenAI Compatible + Claude Compatible
 */

import { getSettings } from '../utils/storage.js';

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class AIEngine {
  static async generateContent(prompt, options = {}) {
    const settings = await getSettings();
    const provider = options.provider || settings.aiProvider || 'cookie_gemini';
    const platform = options.platform || 'general';
    const tone = options.tone || 'engaging';

    console.log('[AI Engine] generateContent platform:', platform, 'provider:', provider, 'threadsFormat:', options.threadsFormat || 'N/A');

    const fullPrompt = this.buildPrompt(prompt, platform, tone, settings.customSystemPrompt, options);

    const candidates = this.buildProviderChain(provider, settings);
    let lastError = null;

    for (const candidate of candidates) {
      try {
        const rawResult = await this.callProvider(candidate, fullPrompt, settings);
        return this.cleanPostFormatting(rawResult);
      } catch (err) {
        lastError = err;
        console.warn(`[AI Engine] Provider "${candidate}" gagal, mencoba fallback berikutnya. ${err.message}`);
      }
    }

    throw lastError || new Error('Tidak ada AI provider yang tersedia.');
  }

  static buildProviderChain(primary, settings) {
    if (primary === 'image_ai') return ['cookie_gemini'];

    const apiAvailable = [];
    if (settings.apiKey) apiAvailable.push('openai_compat');
    if (settings.claudeApiKey) apiAvailable.push('claude_compat');

    const chain = [primary];

    if (primary === 'cookie_chatgpt') {
      chain.push('cookie_gemini');
    } else if (primary === 'cookie_gemini') {
      chain.push('cookie_chatgpt');
    }

    for (const api of apiAvailable) {
      if (!chain.includes(api)) chain.push(api);
    }

    return chain;
  }

  static async callProvider(provider, fullPrompt, settings) {
    switch (provider) {
      case 'cookie_chatgpt':
        return await this.generateChatGPTCookieSession(fullPrompt, settings);
      case 'cookie_gemini':
        return await this.generateGeminiCookieSession(fullPrompt, settings);
      case 'openai_compat':
        return await this.generateOpenAICompat(fullPrompt, settings);
      case 'claude_compat':
        return await this.generateClaudeCompat(fullPrompt, settings);
      case 'image_ai':
        throw new Error('IMAGE AI hanya untuk generate gambar. Pilih provider text lain (Gemini, ChatGPT, OpenAI, atau Claude) untuk generate konten.');
      default:
        throw new Error(`Unknown AI provider: ${provider}`);
    }
  }

  static cleanPostFormatting(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/\*/g, '')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\&/g, '&')
      .replace(/\\n/g, '\n')
      .replace(/\\\n/g, '\n')
      .replace(/\\$/gm, '')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\/g, '')
      .trim();
  }

  static buildPrompt(userTopic, platform, tone, customSystemPrompt, options = {}) {
    let platformRules = '';
    if (platform === 'x') {
      platformRules = 'Format: Keep under 270 characters, punchy hook, clear message, 1-2 relevant hashtags.';
    } else if (platform === 'threads') {
       const mode = options.threadsFormat || options.threadsMode || 'thread';
       if (mode === 'short') {
         platformRules = 'Format: Short concise post under 450 characters total. Punchy hook, 1 clear point, no long threads.';
       } else if (mode === 'attachment') {
         platformRules = 'Format: Detailed long-form post (Text Attachment style, up to 3000 characters). Complete comprehensive analysis, storytelling or structured breakdown with paragraph spacing.';
       } else if (mode === 'poll') {
         platformRules = 'Format: A poll post. Start with a clear poll question as the main text, then list 2-4 concise answer options. At the very end of your response, append a single line: "===POLL=== Option 1 | Option 2 | Option 3" (containing 2 to 4 concise choices separated by "|").';
       } else {
         platformRules = 'Format: Multi-part thread structure. Break into distinct, engaging sections or short paragraphs suitable for a multi-post Utas thread, separated by blank lines. IMPORTANT: DO NOT add any numbering like "1/", "2/", "1.", "2)" or any digit prefix at the start of sections or lines. Never write section numbers in the post text.';
       }
      platformRules += '\nTopic Label (MANDATORY): The VERY FIRST LINE of your response MUST be exactly "TOPIC LABEL: <label>" where <label> is a short noun phrase of maximum 3 words describing the post topic (e.g. "TOPIC LABEL: keuangan pribadi"). Never skip this line, never put it later, never wrap it in quotes or markdown.';
    } else if (platform === 'facebook') {
      platformRules = 'Format: Engaging storytelling style, call to action at the end, clear spacing between paragraphs.';
    } else {
      platformRules = 'Format: Engaging social media style.';
    }
    platformRules += '\nLanguage Matching (MANDATORY): Automatically detect the primary language used in the target post/prompt. You MUST respond in the EXACT SAME LANGUAGE as the target post (e.g. if the post is in English, reply in English; if Indonesian, reply in Indonesian; if Spanish, reply in Spanish, etc.). Match local tone and slang naturally.';

    if (options.useEmoji) {
       platformRules += '\nEmoji: Use relevant emojis naturally to make the post lively and engaging. Do not overdo it — max 4-5 emojis, and never start the post with an emoji.';
     }

     if (options.useImage) {
       platformRules += '\nImage (MANDATORY): Generate a detailed image prompt for the post. At the very end of your response, append a single line: "===IMAGE=== <prompt>" where <prompt> is a detailed, vivid description of the image to generate (20-100 words). The image should visually represent the post topic.';
     }

     if (options.usePoll) {
       platformRules += '\nPolling (MANDATORY): Include an interactive poll at the end of the post text. Format: At the very end of your response text, append a single line: "===POLL=== Option 1 | Option 2 | Option 3" (containing 2 to 4 concise choices separated by "|").';
     }

     if (options.variants && options.variants > 1) {
       platformRules += `\nVariants: Produce exactly ${options.variants} DIFFERENT variants of the post, each a complete and distinct take on the topic. Put a header line on its own before each variant, numbered 1..${options.variants}, like "===VARIANT 1===", "===VARIANT 2===", etc. After each variant header, include that variant's own "TOPIC LABEL: ..." line first, then the post text.`;
     }

     const sysPrompt = (customSystemPrompt || '').trim();
     const prefix = sysPrompt ? `${sysPrompt}\n\n` : '';
     return `${prefix}Platform Target: ${platform.toUpperCase()}\nTone: ${tone}\n${platformRules}\n\nTask/Topic: ${userTopic}\n\nGenerate high quality, ready-to-publish content. Return ONLY the final post text without quotes or meta commentary.`;
  }

  /**
   * ChatGPT Direct Cookie API Fetch (Zero Setup - Pure Cookie Auth)
   */
  static async generateChatGPTCookieSession(promptText, settings = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (settings.customChatgptCookie) {
      headers['Cookie'] = settings.customChatgptCookie;
    }

    const sessionRes = await fetch('https://chatgpt.com/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers
    }).catch(() => null);

    if (!sessionRes || !sessionRes.ok) {
      throw new Error('Tidak dapat terhubung ke chatgpt.com. Klik "Auto-Detect Cookie" atau login di https://chatgpt.com terlebih dahulu.');
    }

    const sessionData = await sessionRes.json().catch(() => ({}));
    const accessToken = sessionData.accessToken;

    if (!accessToken) {
      throw new Error('Sesi login ChatGPT tidak ditemukan. Klik "Auto-Detect Cookie" di Settings.');
    }

    const messageId = generateUUID();
    const parentMessageId = generateUUID();

    headers['Authorization'] = `Bearer ${accessToken}`;

    const response = await fetch('https://chatgpt.com/backend-api/conversation', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        action: 'next',
        messages: [
          {
            id: messageId,
            author: { role: 'user' },
            content: { content_type: 'text', parts: [promptText] },
            metadata: {}
          }
        ],
        model: 'auto',
        parent_message_id: parentMessageId,
        timezone_offset_min: new Date().getTimezoneOffset()
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`ChatGPT Cookie API HTTP Error (${response.status}): ${errText.slice(0, 120)}`);
    }

    const rawSSE = await response.text();

    const sseLines = rawSSE.split('\n');
    const messageMap = {};
    let dataLineCount = 0;

    for (const line of sseLines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ') || trimmed.includes('[DONE]')) continue;

      dataLineCount++;
      try {
        const data = JSON.parse(trimmed.slice(6));
        const msg = data.message;
        if (!msg) continue;

        const msgId = msg.id || 'unknown';
        const role = msg.author?.role || 'unknown';
        const name = msg.author?.name || '';
        const status = msg.status || '';
        const parts = msg.content?.parts;

        if (!messageMap[msgId]) {
          messageMap[msgId] = { role, name, status, texts: [], maxText: '' };
        }

        messageMap[msgId].status = status;

        if (parts && parts.length > 0) {
          const text = parts.join('');
          messageMap[msgId].texts.push(text);
          if (text.length > messageMap[msgId].maxText.length) {
            messageMap[msgId].maxText = text;
          }
        }
      } catch (e) {
        // Ignore partial JSON parse errors
      }
    }

    let bestText = '';
    let fallbackText = '';

    for (const [id, info] of Object.entries(messageMap)) {
      const isAssistant = info.role === 'assistant' && info.name !== 'title_generation';
      if (isAssistant) {
        if (info.maxText.length > bestText.length) {
          bestText = info.maxText;
        }
      } else {
        if (info.maxText.length > fallbackText.length) {
          fallbackText = info.maxText;
        }
      }
    }

    const finalText = bestText || fallbackText;

    if (!finalText) {
      throw new Error(`Respons dari ChatGPT Cookie API kosong. Raw=${rawSSE.length}b, Lines=${dataLineCount}, Messages=${Object.keys(messageMap).length}`);
    }

    return finalText.trim();
  }

  /**
   * Gemini Web Direct Cookie API Fetch (Zero Setup - Pure Cookie Auth)
   */
  static async generateGeminiCookieSession(promptText, settings = {}) {
    const pageHeaders = {};
    if (settings.customGeminiCookie) {
      pageHeaders['Cookie'] = settings.customGeminiCookie;
    }

    const pageRes = await fetch('https://gemini.google.com/app', {
      method: 'GET',
      credentials: 'include',
      headers: pageHeaders
    }).catch(() => null);

    if (!pageRes || !pageRes.ok) {
      throw new Error('Tidak dapat membuka gemini.google.com. Pastikan Anda sudah login di https://gemini.google.com terlebih dahulu.');
    }

    const htmlText = await pageRes.text();
    const snlMatch = htmlText.match(/"SNlM0e":"([^"]+)"/);
    const snlToken = snlMatch ? snlMatch[1] : null;

    if (!snlToken) {
      throw new Error('Sesi Cookie Gemini tidak ditemukan. Silakan buka & login di https://gemini.google.com terlebih dahulu.');
    }

    const reqPayload = [null, JSON.stringify([[promptText], null, [null, null, null], null, null, null, [1]])];
    const formData = new URLSearchParams();
    formData.append('f.req', JSON.stringify(reqPayload));
    formData.append('at', snlToken);

    const apiUrl = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20240520.08_p0&_reqid=100000&rt=c`;

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    };
    if (settings.customGeminiCookie) {
      headers['Cookie'] = settings.customGeminiCookie;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData.toString()
    });

    if (!response.ok) {
      throw new Error(`Gemini Web Cookie API menolak koneksi (HTTP ${response.status}).`);
    }

    const rawText = await response.text();
    let resultText = this.extractCleanGeminiText(rawText);

    if (resultText.startsWith('[') || resultText.startsWith('{')) {
      const titleMatch = resultText.match(/"11"\s*:\s*\["([^"]+)"\]/);
      if (titleMatch && titleMatch[1]) {
        resultText = titleMatch[1];
      } else {
        const rcMatch = resultText.match(/\["rc_[^"]+",\s*\["([\s\S]*?)"\]/);
        if (rcMatch && rcMatch[1]) {
          resultText = rcMatch[1];
        } else {
          const qMatches = resultText.match(/"([^"\\]{6,})"/g) || [];
          const valid = qMatches
            .map(m => m.slice(1, -1))
            .filter(s => /\s/.test(s) && !s.startsWith('c_') && !s.startsWith('r_'));
          if (valid.length > 0) {
            valid.sort((a, b) => b.length - a.length);
            resultText = valid[0];
          }
        }
      }
    }

    if (!resultText || resultText.startsWith('[')) {
      throw new Error('Gagal mengekstrak teks respons dari Gemini Cookie API.');
    }

    return resultText
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\u0026/g, '&')
      .trim();
  }

  static extractCleanGeminiText(rawText) {
    if (!rawText) return '';

    const normalizedText = rawText
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\u0026/g, '&');

    const rcMatches = normalizedText.match(/\["rc_[^"]+",\s*\["([\s\S]*?)"\]/g) || [];
    let longestBody = '';

    for (const matchStr of rcMatches) {
      const subMatch = matchStr.match(/\["rc_[^"]+",\s*\["([\s\S]*?)"\]/);
      if (subMatch && subMatch[1]) {
        const text = subMatch[1].trim();
        if (text.length > longestBody.length && /\s/.test(text)) {
          longestBody = text;
        }
      }
    }

    if (longestBody && longestBody.length > 30) {
      return longestBody;
    }

    const titleMatch = normalizedText.match(/"11"\s*:\s*\["([^"]+)"\]/);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim();
    }

    const allMatches = normalizedText.match(/"([^"\\]*)"/g) || [];
    const validTexts = [];

    for (const m of allMatches) {
      const str = m.slice(1, -1).trim();
      if (
        str.length > 4 &&
        /\s/.test(str) &&
        !/^[cr]_[a-f0-9]{8,}$/i.test(str) &&
        !/^[A-Za-z0-9_-]{20,}$/.test(str) &&
        !str.startsWith('boq_') &&
        !str.startsWith('http') &&
        !str.includes('SWML_') &&
        !str.includes('googlesymbols')
      ) {
        validTexts.push(str);
      }
    }

    if (validTexts.length > 0) {
      validTexts.sort((a, b) => b.length - a.length);
      return validTexts[0];
    }

    const cleaned = normalizedText
      .replace(/\[null,\s*\["[^"]+","[^"]+"\]/gi, '')
      .replace(/,?\s*\{"\d+":[^}]+\}\]/gi, '')
      .replace(/[\[\]{}]/g, '')
      .trim();

    return cleaned;
  }

  /**
   * OpenAI Compatible API — generic OpenAI-compatible endpoint.
   */
  static async generateOpenAICompat(promptText, settings) {
    const apiKey = settings.apiKey;
    if (!apiKey) {
      throw new Error('API Key belum diisi. Silakan isi di tab Settings.');
    }

    let endpoint = (settings.apiEndpoint || 'https://api.openai.com/v1/chat/completions').trim();
    if (!endpoint.endsWith('/chat/completions') && !endpoint.includes('/chat/')) {
      endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
    }
    const model = settings.apiModel || 'gpt-4o-mini';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: promptText }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI Compatible API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Respons dari OpenAI Compatible API kosong');
    return text;
  }

  /**
   * Claude Compatible API — Anthropic Claude API.
   */
  static async generateClaudeCompat(promptText, settings) {
    const apiKey = settings.claudeApiKey;
    if (!apiKey) {
      throw new Error('Claude API Key belum diisi. Silakan isi di tab Settings.');
    }

    const endpoint = settings.claudeEndpoint || 'https://api.anthropic.com/v1/messages';
    const model = settings.claudeModel || 'claude-3-7-sonnet-20250219';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [
          { role: 'user', content: promptText }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude Compatible API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) throw new Error('Respons dari Claude Compatible API kosong');
    return text;
  }

  /**
   * Generate an image using an OpenAI-compatible image API.
   */
  static async generateImage(prompt) {
    const settings = await getSettings();
    const endpoint = settings.imageGenEndpoint || '';
    const model = settings.imageGenModel || '';
    const apiKey = settings.imageGenApiKey || '';

    if (!endpoint || !apiKey) {
      console.warn('[AI Engine] Image gen settings belum dikonfigurasi');
      return null;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      return data.data?.[0]?.url || null;
    } catch (e) {
      console.warn('[AI Engine] Gagal generate gambar:', e.message);
      return null;
    }
  }
}