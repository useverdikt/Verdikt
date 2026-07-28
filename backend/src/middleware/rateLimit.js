"use strict";

const { LOGIN_RATE_LIMIT_PER_MINUTE, WEBHOOK_RATE_LIMIT_PER_MINUTE, REDIS_URL } = require("../config");
const { sendError } = require("../lib/apiError");

const webhookRateWindow = new Map();
const loginRateWindow = new Map();
const forgotPasswordRateWindow = new Map();
const registerRateWindow = new Map();
const waitlistRateWindow = new Map();
const signalIngestKeyWindow = new Map();
const signalIngestWorkspaceWindow = new Map();
const gatePollKeyWindow = new Map();
const gatePollWorkspaceWindow = new Map();

const REGISTER_RATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.REGISTER_RATE_LIMIT_PER_HOUR || 15));
const WAITLIST_RATE_LIMIT_PER_HOUR = Math.max(3, Number(process.env.WAITLIST_RATE_LIMIT_PER_HOUR || 30));

function signalIngestKeyLimit() {
  return Math.max(1, Number(process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_KEY || 120));
}
function signalIngestWorkspaceLimit() {
  return Math.max(1, Number(process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE || 300));
}
function gatePollKeyLimit() {
  return Math.max(1, Number(process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_KEY || 60));
}
function gatePollWorkspaceLimit() {
  return Math.max(1, Number(process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE || 200));
}

function bypassRateLimit() {
  return process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1";
}

let redisClient;
let redisWarned;

function getRedis() {
  if (!REDIS_URL) return null;
  if (redisClient === undefined) {
    try {
      const Redis = require("ioredis");
      redisClient = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
        enableOfflineQueue: false
      });
      redisClient.on("error", (err) => {
        if (!redisWarned) {
          redisWarned = true;
          console.warn("[rateLimit] Redis error; falling back to in-memory:", err.message || err);
        }
      });
    } catch (e) {
      redisClient = null;
      if (!redisWarned) {
        redisWarned = true;
        console.warn("[rateLimit] Redis unavailable; using in-memory:", e.message || e);
      }
    }
  }
  return redisClient;
}

async function redisIncrWithTtl(key, ttlSeconds) {
  const r = getRedis();
  if (!r) return null;
  try {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, ttlSeconds);
    return n;
  } catch {
    return null;
  }
}

function checkLoginRateLimitMemory(ip, email) {
  const now = Date.now();
  const cutoff = now - 60 * 1000;
  const key = `${ip || "unknown"}:${email || "unknown"}`;
  const bucket = (loginRateWindow.get(key) || []).filter((t) => t > cutoff);
  if (bucket.length >= LOGIN_RATE_LIMIT_PER_MINUTE) {
    loginRateWindow.set(key, bucket);
    return false;
  }
  bucket.push(now);
  loginRateWindow.set(key, bucket);
  return true;
}

async function checkLoginRateLimit(ip, email) {
  if (bypassRateLimit()) return true;
  const window = Math.floor(Date.now() / 60_000);
  const key = `rl:login:v1:${ip || "unknown"}:${email || "unknown"}:${window}`;
  const n = await redisIncrWithTtl(key, 70);
  if (n != null) return n <= LOGIN_RATE_LIMIT_PER_MINUTE;
  return checkLoginRateLimitMemory(ip, email);
}

function checkForgotPasswordRateLimitMemory(ip) {
  const now = Date.now();
  const cutoff = now - 15 * 60 * 1000;
  const key = (ip || "unknown").toString();
  const bucket = (forgotPasswordRateWindow.get(key) || []).filter((t) => t > cutoff);
  if (bucket.length >= 8) {
    forgotPasswordRateWindow.set(key, bucket);
    return false;
  }
  bucket.push(now);
  forgotPasswordRateWindow.set(key, bucket);
  return true;
}

async function checkForgotPasswordRateLimit(ip) {
  if (bypassRateLimit()) return true;
  const window = Math.floor(Date.now() / (15 * 60_000));
  const key = `rl:forgot:v1:${(ip || "unknown").toString()}:${window}`;
  const n = await redisIncrWithTtl(key, 16 * 60);
  if (n != null) return n <= 8;
  return checkForgotPasswordRateLimitMemory(ip);
}

function checkRegisterRateLimitMemory(ip) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const key = (ip || "unknown").toString();
  const bucket = (registerRateWindow.get(key) || []).filter((t) => t > cutoff);
  if (bucket.length >= REGISTER_RATE_LIMIT_PER_HOUR) {
    registerRateWindow.set(key, bucket);
    return false;
  }
  bucket.push(now);
  registerRateWindow.set(key, bucket);
  return true;
}

async function checkRegisterRateLimit(ip) {
  if (bypassRateLimit()) return true;
  const window = Math.floor(Date.now() / (60 * 60_000));
  const key = `rl:register:v1:${(ip || "unknown").toString()}:${window}`;
  const n = await redisIncrWithTtl(key, 70 * 60);
  if (n != null) return n <= REGISTER_RATE_LIMIT_PER_HOUR;
  return checkRegisterRateLimitMemory(ip);
}

function checkWaitlistRateLimitMemory(ip) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const key = (ip || "unknown").toString();
  const bucket = (waitlistRateWindow.get(key) || []).filter((t) => t > cutoff);
  if (bucket.length >= WAITLIST_RATE_LIMIT_PER_HOUR) {
    waitlistRateWindow.set(key, bucket);
    return false;
  }
  bucket.push(now);
  waitlistRateWindow.set(key, bucket);
  return true;
}

async function checkWaitlistRateLimit(ip) {
  if (bypassRateLimit()) return true;
  const window = Math.floor(Date.now() / (60 * 60_000));
  const key = `rl:waitlist:v1:${(ip || "unknown").toString()}:${window}`;
  const n = await redisIncrWithTtl(key, 70 * 60);
  if (n != null) return n <= WAITLIST_RATE_LIMIT_PER_HOUR;
  return checkWaitlistRateLimitMemory(ip);
}

function checkRateLimitMemory(windowMap, key, limit, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = (windowMap.get(key) || []).filter((t) => t > cutoff);
  if (bucket.length >= limit) {
    windowMap.set(key, bucket);
    return false;
  }
  bucket.push(now);
  windowMap.set(key, bucket);
  return true;
}

async function checkDualRateLimit({ keyPrefix, keyId, workspaceId, keyLimit, workspaceLimit }) {
  if (bypassRateLimit()) return true;
  const window = Math.floor(Date.now() / 60_000);
  const keyKey = `${keyPrefix}:key:v1:${keyId}:${window}`;
  const wsKey = `${keyPrefix}:ws:v1:${workspaceId}:${window}`;
  const [keyCount, wsCount] = await Promise.all([
    redisIncrWithTtl(keyKey, 70),
    redisIncrWithTtl(wsKey, 70)
  ]);
  if (keyCount == null || wsCount == null) return null;
  return keyCount <= keyLimit && wsCount <= workspaceLimit;
}

async function checkSignalIngestRateLimit(keyId, workspaceId) {
  const ok = await checkDualRateLimit({
    keyPrefix: "rl:ingest",
    keyId,
    workspaceId,
    keyLimit: signalIngestKeyLimit(),
    workspaceLimit: signalIngestWorkspaceLimit()
  });
  if (ok != null) return ok;
  const memKeyOk = checkRateLimitMemory(signalIngestKeyWindow, keyId, signalIngestKeyLimit(), 60_000);
  if (!memKeyOk) return false;
  return checkRateLimitMemory(signalIngestWorkspaceWindow, workspaceId, signalIngestWorkspaceLimit(), 60_000);
}

async function checkGatePollRateLimit(keyId, workspaceId) {
  const ok = await checkDualRateLimit({
    keyPrefix: "rl:gate",
    keyId,
    workspaceId,
    keyLimit: gatePollKeyLimit(),
    workspaceLimit: gatePollWorkspaceLimit()
  });
  if (ok != null) return ok;
  const memKeyOk = checkRateLimitMemory(gatePollKeyWindow, keyId, gatePollKeyLimit(), 60_000);
  if (!memKeyOk) return false;
  return checkRateLimitMemory(gatePollWorkspaceWindow, workspaceId, gatePollWorkspaceLimit(), 60_000);
}

async function signalIngestRateLimit(req, res, next) {
  try {
    const keyId = req.auth?.sub || req.auth?.apiKeyId || req.ip || "unknown";
    const workspaceId = req.auth?.ws || req.params.workspaceId || "unknown";
    const ok = await checkSignalIngestRateLimit(keyId, workspaceId);
    if (!ok) {
      return sendError(res, req, 429, "signal_ingest_rate_limited", {
        message: "Signal ingest rate limit exceeded"
      });
    }
    next();
  } catch (e) {
    next(e);
  }
}

async function gatePollRateLimit(req, res, next) {
  try {
    const keyId = req.auth?.sub || req.auth?.apiKeyId || req.ip || "unknown";
    const workspaceId = req.auth?.ws || req.params.workspaceId || "unknown";
    const ok = await checkGatePollRateLimit(keyId, workspaceId);
    if (!ok) {
      return sendError(res, req, 429, "gate_poll_rate_limited", {
        message: "Gate poll rate limit exceeded"
      });
    }
    next();
  } catch (e) {
    next(e);
  }
}

function checkWebhookRateLimitMemory(ip) {
  const now = Date.now();
  const cutoff = now - 60 * 1000;
  const bucket = (webhookRateWindow.get(ip) || []).filter((t) => t > cutoff);
  if (bucket.length >= WEBHOOK_RATE_LIMIT_PER_MINUTE) {
    webhookRateWindow.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  webhookRateWindow.set(ip, bucket);
  return true;
}

async function checkWebhookRateLimit(ip) {
  if (bypassRateLimit()) return true;
  const window = Math.floor(Date.now() / 60_000);
  const key = `rl:webhook:v1:${ip}:${window}`;
  const n = await redisIncrWithTtl(key, 70);
  if (n != null) return n <= WEBHOOK_RATE_LIMIT_PER_MINUTE;
  return checkWebhookRateLimitMemory(ip);
}

async function webhookRateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim();
  try {
    const ok = await checkWebhookRateLimit(ip);
    if (!ok) {
      console.warn(`[${req.requestId}] webhook rate limit exceeded`, { ip });
      return sendError(res, req, 429, "webhook_rate_limited", {
        message: "Webhook rate limit exceeded"
      });
    }
    next();
  } catch (e) {
    next(e);
  }
}

const RATE_LIMIT_PRUNE_MS = 120 * 1000;
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_PRUNE_MS;
  for (const map of [
    loginRateWindow, webhookRateWindow, forgotPasswordRateWindow, registerRateWindow, waitlistRateWindow,
    signalIngestKeyWindow, signalIngestWorkspaceWindow, gatePollKeyWindow, gatePollWorkspaceWindow
  ]) {
    for (const [key, bucket] of [...map.entries()]) {
      const fresh = bucket.filter((t) => t > cutoff);
      if (!fresh.length) map.delete(key);
      else map.set(key, fresh);
    }
  }
}, 60_000).unref?.();

module.exports = {
  checkLoginRateLimit,
  checkForgotPasswordRateLimit,
  checkRegisterRateLimit,
  checkWaitlistRateLimit,
  webhookRateLimit,
  signalIngestRateLimit,
  gatePollRateLimit,
  checkSignalIngestRateLimit,
  checkGatePollRateLimit
};
