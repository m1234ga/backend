
import pool from './DBConnection';

async function listUsers() {
    try {
        const res = await pool.query('SELECT username, email, role FROM app_users');
        console.log('Users in database:');
        console.table(res.rows);
    } catch (error) {
        console.error('Error listing users:', error);
    } finally {
        process.exit();
    }
}

listUsers();
