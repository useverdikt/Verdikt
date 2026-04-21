"use strict";

const {
  AI_CALL_TIMEOUT_MS,
  AI_CALL_RETRIES,
  AI_PROVIDER,
  AI_MODEL,
  AI_PROVIDER_API_KEY
} = require("../config");

async function withTimeoutRetry(task, { timeoutMs = AI_CALL_TIMEOUT_MS, retries = AI_CALL_RETRIES } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await Promise.race([
        task(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("ai_call_timeout")), timeoutMs))
      ]);
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? String(err.message) : "";
      if (msg !== "ai_call_timeout") throw err;
      if (attempt === retries) throw err;
    }
  }
  throw lastErr || new Error("ai_call_failed");
}

async function callIntelligenceModel(prompt, { maxTokens = 140 } = {}) {
  if (!AI_PROVIDER_API_KEY || typeof fetch !== "function") return "";
  if (AI_PROVIDER === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AI_MODEL)}:generateContent?key=${encodeURIComponent(AI_PROVIDER_API_KEY)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens }
      })
    });
    if (!r.ok) throw new Error(`ai_call_http_${r.status}`);
    const j = await r.json();
    const text = (j?.candidates || [])
      .flatMap((c) => c?.content?.parts || [])
      .map((p) => p?.text || "")
      .join(" ")
      .trim();
    return text || "";
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AI_PROVIDER_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!r.ok) throw new Error(`ai_call_http_${r.status}`);
  const j = await r.json();
  const text = Array.isArray(j?.content) ? j.content.find((c) => c?.type === "text")?.text : "";
  return (text || "").trim();
}

function tryParseJsonObject(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

module.exports = { withTimeoutRetry, callIntelligenceModel, tryParseJsonObject };
