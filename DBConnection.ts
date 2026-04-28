import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';
import path from 'path';

const envPaths = [
  path.join(__dirname, '.env'),
  path.join(process.cwd(), 'backend', '.env'),
  path.join(process.cwd(), '.env'),
];

for (const envPath of envPaths) {
  const result = loadEnv({ path: envPath });
  if (!result.error) {
    break;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,              // Increased from default 10 for better concurrency
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000, // 30s timeout per query
});

// Helper to provide compatibility with existing code that expects getConnection().execute()
export async function getConnection() {
  return {
    // execute(sql, params?) returns [rows, fields] similar to mysql2/promise
    execute: async (sql: string, params?: any[]) => {
      const res = await pool.query(sql, params || []);
      return [res.rows, res.fields];
    },
    query: async (sql: string, params?: any[]) => {
      return pool.query(sql, params || []);
    }
  };
}

export default pool;