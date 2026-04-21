"use strict";

const { queryOne } = require("../database");

/**
 * Load application user by primary id (same string as Supabase public.users.id when using auth trigger).
 * @param {string} id
 * @returns {Promise<{ id: string, email: string, name: string, workspace_id: string, role: string } | undefined>}
 */
async function getUserRowForAuthById(id) {
  const sid = String(id);
  return queryOne("SELECT id, email, name, workspace_id, role FROM users WHERE id = ?", [sid]);
}

/**
 * Resolve user after Supabase Auth sign-in (JWT `sub` = auth user id = public.users.id text).
 * @param {string} authSub
 */
async function findApplicationUserForSupabaseSub(authSub) {
  const sid = String(authSub);
  return queryOne(
    "SELECT id, email, name, workspace_id, role FROM users WHERE auth_user_id = ? OR id = ?",
    [sid, sid]
  );
}

module.exports = { getUserRowForAuthById, findApplicationUserForSupabaseSub };
