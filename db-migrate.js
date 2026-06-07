const pool = require('./DBConnection').default || require('./DBConnection');

async function migrate() {
  try {
    console.log('Adding rating to chats...');
    await pool.query('ALTER TABLE chats ADD COLUMN IF NOT EXISTS rating SMALLINT;');
    
    console.log('Creating sla_targets table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sla_targets (
        id SERIAL PRIMARY KEY,
        target_type VARCHAR(50) NOT NULL,
        target_value_minutes INTEGER NOT NULL,
        priority VARCHAR(50),
        created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Seeding sla_targets table...');
    const result = await pool.query('SELECT COUNT(*) FROM sla_targets');
    if (parseInt(result.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO sla_targets (target_type, target_value_minutes, priority) VALUES 
        ('first_response', 15, 'high'),
        ('first_response', 30, 'normal'),
        ('resolution', 360, 'high'),
        ('resolution', 1440, 'normal');
      `);
    }

    console.log('Creating audit_logs table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id VARCHAR(50),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45)
      );
    `);
    
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);');

    console.log('Migration completed successfully.');
  } catch(e) {
    console.error('Migration failed:', e);
  } finally {
    process.exit(0);
  }
}

migrate();
