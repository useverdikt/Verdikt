#!/usr/bin/env node
/**
 * Ensures demo@verdikt.local and screenshots@verdikt.local exist in Supabase Auth
 * and links public.users.auth_user_id for session exchange (SPA Supabase login).
 *
 * Requires in backend/.env (or env):
 *   DATABASE_URL           — same Postgres as Supabase (pooler or direct)
 *   SUPABASE_URL           — https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — Dashboard → Settings → API → service_role (secret; never commit)
 *
 * Run from backend/:  npm run seed:demos:supabase
 */
"use strict";

require("../src/config");
const { Pool } = require("pg");

const DEMOS = [
  { email: "demo@verdikt.local", password: "demo123" },
  { email: "screenshots@verdikt.local", password: "demo123" }
];

function normalizeSupabaseUrl(raw) {
  const s = String(raw || "").trim().replace(/\/$/, "");
  if (!s) throw new Error("SUPABASE_URL is required (e.g. https://xxxx.supabase.co)");
  return s;
}

/** @returns {Promise<string|undefined>} */
async function queryAuthUserId(pool, email) {
  try {
    const { rows } = await pool.query("SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1", [
      email
    ]);
    return rows[0]?.id ? String(rows[0].id) : undefined;
  } catch (e) {
    if (e.code === "42501" || String(e.message || "").includes("permission denied")) {
      return undefined;
    }
    throw e;
  }
}

async function createAuthUserAdmin(supabaseUrl, serviceKey, email, password) {
  const url = `${normalizeSupabaseUrl(supabaseUrl)}/auth/v1/admin/users`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: email.trim(),
      password,
      email_confirm: true
    })
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    const id = data.user?.id || data.id;
    if (id) return String(id);
    throw new Error(`Create user response missing id: ${JSON.stringify(data)}`);
  }
  const msg = JSON.stringify(data);
  const duplicate =
    res.status === 422 ||
    res.status === 409 ||
    /already|registered|exists|duplicate/i.test(msg);
  if (duplicate) return null;
  throw new Error(`Create auth user failed (${res.status}): ${msg}`);
}

async function listAuthUsersFindId(supabaseUrl, serviceKey, email) {
  const base = `${normalizeSupabaseUrl(supabaseUrl)}/auth/v1/admin/users`;
  let page = 1;
  const target = email.trim().toLowerCase();
  while (page <= 100) {
    const res = await fetch(`${base}?page=${page}&per_page=200`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`List auth users failed (${res.status}): ${JSON.stringify(data)}`);
    const users = data.users;
    if (!Array.isArray(users)) break;
    const hit = users.find((u) => u && String(u.email || "").toLowerCase() === target);
    if (hit?.id) return String(hit.id);
    if (users.length < 200) break;
    page += 1;
  }
  return undefined;
}

async function ensureAuthUserId(pool, supabaseUrl, serviceKey, email, password) {
  let id = await queryAuthUserId(pool, email);
  if (id) return id;

  try {
    const created = await createAuthUserAdmin(supabaseUrl, serviceKey, email, password);
    if (created) return created;
  } catch (e) {
    throw e;
  }

  id = await queryAuthUserId(pool, email);
  if (id) return id;

  id = await listAuthUsersFindId(supabaseUrl, serviceKey, email);
  if (id) return id;

  throw new Error(`Could not resolve auth user id for ${email}`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim();
  const supabaseUrl = process.env.SUPABASE_URL && String(process.env.SUPABASE_URL).trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY && String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim();

  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  if (!supabaseUrl) {
    console.error("SUPABASE_URL is required (e.g. https://xxxx.supabase.co).");
    process.exit(1);
  }
  if (!serviceKey) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY is required (Supabase Dashboard → Settings → API → service_role secret)."
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: /supabase\.co|pooler\.supabase/i.test(databaseUrl) ? { rejectUnauthorized: false } : undefined
  });

  try {
    for (const { email, password } of DEMOS) {
      const authId = await ensureAuthUserId(pool, supabaseUrl, serviceKey, email, password);
      const u = await pool.query("SELECT id, email, auth_user_id FROM public.users WHERE lower(email) = lower($1)", [
        email
      ]);
      if (!u.rows.length) {
        console.warn(`[skip] No public.users row for ${email} — run npm run seed:demos first.`);
        continue;
      }
      await pool.query("UPDATE public.users SET auth_user_id = $1 WHERE lower(email) = lower($2)", [authId, email]);
      console.log(`Linked ${email} → auth_user_id=${authId}`);
    }
    console.log("Done. Demo accounts should work with Supabase sign-in + session exchange.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
