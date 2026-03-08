
import pool from './DBConnection';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

async function createAdmin() {
    const username = 'admin';
    const password = 'admin';
    const email = 'admin@example.com';

    try {
        const userCheck = await pool.query('SELECT id FROM app_users WHERE username = $1', [username]);
        if (userCheck.rows.length > 0) {
            console.log('Admin user already exists.');
            return;
        }

        const id = uuidv4();
        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            `INSERT INTO app_users (id, username, email, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, username, email, hashedPassword, 'Admin', 'User', 'admin']
        );

        console.log('✅ Admin user created successfully!');
        console.log('Username: admin');
        console.log('Password: admin');
    } catch (error) {
        console.error('Error creating admin user:', error);
    } finally {
        process.exit();
    }
}

createAdmin();
