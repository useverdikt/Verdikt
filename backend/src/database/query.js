"use strict";

/**
 * Async DB API backed by PostgreSQL. SQLite-style `?` placeholders are converted to `$1..$n`.
 */
const { getPool, closePool } = require("../db/pg");

/**
 * @param {string} sql
 * @returns {string}
 */
function toPg(sql) {
  let s = sql.replace(/\bdatetime\s*\(\s*\?\s*\)/gi, "?");
  s = s.replace(/\bdatetime\s*\(\s*([a-zA-Z0-9_.]+)\s*\)/gi, "$1");
  let n = 0;
  s = s.replace(/\?/g, () => `$${++n}`);
  return s;
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function query(sql, params = []) {
  return getPool().query(toPg(sql), params);
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function queryOne(sql, params = []) {
  const { rows } = await getPool().query(toPg(sql), params);
  return rows[0];
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function queryAll(sql, params = []) {
  const { rows } = await getPool().query(toPg(sql), params);
  return rows;
}

/**
 * INSERT/UPDATE/DELETE. For INSERT needing id, include `RETURNING id` (Postgres).
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function run(sql, params = []) {
  const { rows, rowCount } = await getPool().query(toPg(sql), params);
  const id = rows && rows[0] && (rows[0].id ?? rows[0].Id);
  return {
    changes: rowCount ?? 0,
    lastInsertRowid: id != null ? id : undefined,
    rows: rows || []
  };
}

/**
 * @param {(tx: { query: Function, queryOne: Function, queryAll: Function, run: Function }) => void | Promise<void>} fn
 */
async function transaction(fn) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = {
      query: (sql, params) => client.query(toPg(sql), params),
      queryOne: async (sql, params = []) => {
        const { rows } = await client.query(toPg(sql), params);
        return rows[0];
      },
      queryAll: async (sql, params = []) => {
        const { rows } = await client.query(toPg(sql), params);
        return rows;
      },
      run: async (sql, params = []) => {
        const { rows, rowCount } = await client.query(toPg(sql), params);
        const id = rows && rows[0] && (rows[0].id ?? rows[0].Id);
        return {
          changes: rowCount ?? 0,
          lastInsertRowid: id != null ? id : undefined,
          rows: rows || []
        };
      }
    };
    await fn(tx);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  toPg,
  query,
  queryOne,
  queryAll,
  run,
  transaction,
  closePool
};
