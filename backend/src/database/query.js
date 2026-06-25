"use strict";

/**
 * Async DB API backed by PostgreSQL ($1..$n placeholders).
 */
const { getPool, closePool } = require("../db/pg");

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function query(sql, params = []) {
  return getPool().query(sql, params);
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function queryOne(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows[0];
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function queryAll(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows;
}

/**
 * INSERT/UPDATE/DELETE. For INSERT needing id, include `RETURNING id` (Postgres).
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function run(sql, params = []) {
  const { rows, rowCount } = await getPool().query(sql, params);
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
      query: (sql, params) => client.query(sql, params),
      queryOne: async (sql, params = []) => {
        const { rows } = await client.query(sql, params);
        return rows[0];
      },
      queryAll: async (sql, params = []) => {
        const { rows } = await client.query(sql, params);
        return rows;
      },
      run: async (sql, params = []) => {
        const { rows, rowCount } = await client.query(sql, params);
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
  query,
  queryOne,
  queryAll,
  run,
  transaction,
  closePool
};
