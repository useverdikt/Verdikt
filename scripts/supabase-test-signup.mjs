#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, "frontend", ".env.local");
const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node supabase-test-signup.mjs <email> <password>");
  process.exit(1);
}

let url;
let anon;
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^VITE_SUPABASE_URL=(.+)$/);
    if (m) url = m[1].trim();
    const m2 = line.match(/^VITE_SUPABASE_ANON_KEY=(.+)$/);
    if (m2) anon = m2[1].trim();
  }
} catch {
  console.error("Missing frontend/.env.local — run write-supabase-local-env.mjs first");
  process.exit(1);
}

if (!url || !anon) {
  console.error("Could not parse VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local");
  process.exit(1);
}

const authUrl = `${url.replace(/\/$/, "")}/auth/v1/signup`;
const res = await fetch(authUrl, {
  method: "POST",
  headers: {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password }),
});
const text = await res.text();
if (!res.ok) {
  console.error("Signup failed:", res.status, text);
  process.exit(1);
}
console.log("Signup OK:", text.slice(0, 200));
