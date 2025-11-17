import { Pool } from 'pg';

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'wuzapi',
  password: 'q',
  port: 5432,
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