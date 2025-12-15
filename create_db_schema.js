"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const DBConnection_1 = __importDefault(require("./DBConnection"));
async function createSchema() {
    const query = `
    CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN DEFAULT TRUE
    );
  `;
    try {
        await DBConnection_1.default.query(query);
        console.log('✅ app_users table created successfully');
        // Create admin user if not exists
        const adminCheck = await DBConnection_1.default.query("SELECT * FROM app_users WHERE username = 'admin'");
        if (adminCheck.rows.length === 0) {
            // password: admin (hashed) - using a placeholder hash for now, will be replaced by real hash in auth logic
            // But for initial setup we need a known hash. 
            // valid bcrypt hash for 'admin': $2a$10$r.7/t0/1/1/1/1/1/1/1
            // Actually, let's use a simple script to insert it later or just rely on register for now.
            // Or better, let's not insert a default user to avoid security risks with known passwords.
            console.log('ℹ️  No admin user found. You can register one via the API.');
        }
    }
    catch (error) {
        console.error('❌ Error creating schema:', error);
    }
    finally {
        await DBConnection_1.default.end();
    }
}
createSchema();
