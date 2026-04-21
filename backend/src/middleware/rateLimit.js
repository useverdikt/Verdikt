"use strict";

const { LOGIN_RATE_LIMIT_PER_MINUTE, WEBHOOK_RATE_LIMIT_PER_MINUTE, REDIS_URL } = require("../config");

const webhookRateWindow = new Map();
const loginRateWindow = new Map();
const forgotPasswordRateWindow = new Map();
const registerRateWindow = new Map();
const waitlistRateWindow = new Map();

const REGISTER_RATE_LIMIT_PER_HOUR = Math.max(1, Number(process.env.REGISTER_RATE_LIMIT_PER_HOUR || 15));
const WAITLIST_RATE_LIMIT_PER_HOUR = Math.max(3, Number(process.env.WAITLIST_RATE_LIMIT_PER_HOUR || 30));

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
  const window = Math.floor(Date.now() / (60 * 60_000));
  const key = `rl:waitlist:v1:${(ip || "unknown").toString()}:${window}`;
  const n = await redisIncrWithTtl(key, 70 * 60);
  if (n != null) return n <= WAITLIST_RATE_LIMIT_PER_HOUR;
  return checkWaitlistRateLimitMemory(ip);
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
      return res.status(429).json({ error: "Webhook rate limit exceeded" });
    }
    next();
  } catch (e) {
    next(e);
  }
}

const RATE_LIMIT_PRUNE_MS = 120 * 1000;
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_PRUNE_MS;
  for (const map of [loginRateWindow, webhookRateWindow, forgotPasswordRateWindow, registerRateWindow, waitlistRateWindow]) {
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
  webhookRateLimit
};
