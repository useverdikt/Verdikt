import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "../../../backend/package.json"));
const { Client } = require("pg");

/**
 * Sets users.role and workspace_members.role for E2E (server-authoritative RBAC).
 */
export async function setUserRoleByEmail(email, role) {
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    "postgresql://127.0.0.1:5432/verdikt_test";
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "UPDATE users SET role = $1 WHERE email = $2 RETURNING id, workspace_id",
      [role, email]
    );
    if (result.rowCount === 0) {
      throw new Error(`E2E: user not found for role update: ${email}`);
    }
    const { id, workspace_id } = result.rows[0];
    await client.query(
      "UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3",
      [role, workspace_id, id]
    );
  } finally {
    await client.end();
  }
}
