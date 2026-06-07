const pool = require('./DBConnection').default || require('./DBConnection');

async function test() {
  try {
    const res = await pool.query(`
      SELECT 
        t."tagId"::text as "tagId",
        t."tagName",
        COUNT(DISTINCT c.id) as "chatsPerTag",
        COUNT(DISTINCT CASE WHEN csd.status = 'open' THEN c.id END) as "openChats",
        COUNT(DISTINCT CASE WHEN csd.status = 'closed' OR csd.status = 'resolved' THEN c.id END) as "closedChats",
        AVG(
            (SELECT EXTRACT(EPOCH FROM(MAX(csd_closed.changed_at) - MIN(csd_open.changed_at))) / 60
             FROM chat_status_details csd_open
             JOIN chat_status_details csd_closed ON csd_open.chat_id = csd_closed.chat_id
             WHERE csd_open.chat_id = c.id AND csd_open.status = 'open' AND (csd_closed.status = 'closed' OR csd_closed.status = 'resolved')
            )
        ) as "avgArt"
      FROM tags t
      JOIN "chatTags" ct ON t."tagId" = ct."tagId"
      JOIN chats c ON ct."chatId" = c.id
      LEFT JOIN (
        SELECT DISTINCT ON(chat_id) chat_id, status, changed_at
        FROM chat_status_details 
        ORDER BY chat_id, changed_at DESC
      ) csd ON c.id = csd.chat_id
      WHERE ct."creationDate" >= NOW() - INTERVAL '7 days'
      GROUP BY t."tagId", t."tagName"
      ORDER BY "chatsPerTag" DESC
    `);
    console.log('Result:', res.rows);
  } catch(e) {
    console.error('ERROR:', e.message);
  } finally {
    process.exit(0);
  }
}

test();
