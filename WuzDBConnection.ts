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

const connectionString = process.env.WUZ_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Missing database URL: set WUZ_DATABASE_URL (or DATABASE_URL fallback)');
}

const wuzPool = new Pool({
  connectionString,
});

export default wuzPool;
