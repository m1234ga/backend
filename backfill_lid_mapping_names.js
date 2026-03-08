"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prismaClient_1 = __importDefault(require("./prismaClient"));
function stripJidSuffixExpr(column) {
    return `regexp_replace(${column}, '@(s\\.whatsapp\\.net|whatsapp|lid)$', '', 'i')`;
}
async function dryRun() {
    const rows = await prismaClient_1.default.$queryRawUnsafe(`
    WITH normalized_contacts AS (
      SELECT
        their_jid,
        ${stripJidSuffixExpr('their_jid')} AS jid_bare,
        first_name,
        full_name,
        push_name,
        business_name
      FROM whatsmeow_contacts
      WHERE their_jid IS NOT NULL
    ),
    matched AS (
      SELECT DISTINCT lm.lid
      FROM lid_mappings lm
      JOIN normalized_contacts nc
        ON lm.lid = nc.jid_bare OR lm.phone = nc.jid_bare
      WHERE nc.first_name IS NOT NULL
         OR nc.full_name IS NOT NULL
         OR nc.push_name IS NOT NULL
         OR nc.business_name IS NOT NULL
    )
    SELECT COUNT(*)::bigint AS count
    FROM matched
    `);
    const affected = Number(rows[0]?.count ?? 0n);
    console.log(`[DRY-RUN] lid_mappings rows that would be updated: ${affected}`);
    const preview = await prismaClient_1.default.$queryRawUnsafe(`
    WITH normalized_contacts AS (
      SELECT
        ${stripJidSuffixExpr('their_jid')} AS jid_bare,
        first_name,
        full_name,
        push_name,
        business_name
      FROM whatsmeow_contacts
      WHERE their_jid IS NOT NULL
    ),
    resolved AS (
      SELECT
        lm.lid,
        lm.phone,
        lm.full_name AS old_full_name,
        lm.first_name AS old_first_name,
        lm.push_name AS old_push_name,
        lm.business_name AS old_business_name,
        nc.full_name AS new_full_name,
        nc.first_name AS new_first_name,
        nc.push_name AS new_push_name,
        nc.business_name AS new_business_name,
        ROW_NUMBER() OVER (
          PARTITION BY lm.lid
          ORDER BY
            (nc.full_name IS NOT NULL)::int DESC,
            (nc.first_name IS NOT NULL)::int DESC,
            (nc.push_name IS NOT NULL)::int DESC,
            (nc.business_name IS NOT NULL)::int DESC
        ) AS rn
      FROM lid_mappings lm
      JOIN normalized_contacts nc
        ON lm.lid = nc.jid_bare OR lm.phone = nc.jid_bare
      WHERE nc.first_name IS NOT NULL
         OR nc.full_name IS NOT NULL
         OR nc.push_name IS NOT NULL
         OR nc.business_name IS NOT NULL
    )
    SELECT
      lid,
      phone,
      old_full_name,
      new_full_name,
      old_first_name,
      new_first_name,
      old_push_name,
      new_push_name,
      old_business_name,
      new_business_name
    FROM resolved
    WHERE rn = 1
    ORDER BY lid
    LIMIT 20
    `);
    if (preview.length > 0) {
        console.log('[DRY-RUN] Preview (first 20 rows):');
        console.table(preview);
    }
}
async function applyBackfill() {
    const updatedRows = await prismaClient_1.default.$queryRawUnsafe(`
    WITH normalized_contacts AS (
      SELECT
        ${stripJidSuffixExpr('their_jid')} AS jid_bare,
        first_name,
        full_name,
        push_name,
        business_name
      FROM whatsmeow_contacts
      WHERE their_jid IS NOT NULL
    ),
    dedup AS (
      SELECT
        lm.lid,
        nc.full_name,
        nc.first_name,
        nc.push_name,
        nc.business_name,
        ROW_NUMBER() OVER (
          PARTITION BY lm.lid
          ORDER BY
            (nc.full_name IS NOT NULL)::int DESC,
            (nc.first_name IS NOT NULL)::int DESC,
            (nc.push_name IS NOT NULL)::int DESC,
            (nc.business_name IS NOT NULL)::int DESC
        ) AS rn
      FROM lid_mappings lm
      JOIN normalized_contacts nc
        ON lm.lid = nc.jid_bare OR lm.phone = nc.jid_bare
      WHERE nc.first_name IS NOT NULL
         OR nc.full_name IS NOT NULL
         OR nc.push_name IS NOT NULL
         OR nc.business_name IS NOT NULL
    ),
    picked AS (
      SELECT lid, full_name, first_name, push_name, business_name
      FROM dedup
      WHERE rn = 1
    )
    UPDATE lid_mappings lm
    SET
      full_name = COALESCE(p.full_name, lm.full_name),
      first_name = COALESCE(p.first_name, lm.first_name),
      push_name = COALESCE(p.push_name, lm.push_name),
      business_name = COALESCE(p.business_name, lm.business_name),
      is_my_contact = CASE
        WHEN COALESCE(p.full_name, p.first_name) IS NOT NULL THEN true
        ELSE lm.is_my_contact
      END,
      is_business = CASE
        WHEN p.business_name IS NOT NULL THEN true
        ELSE lm.is_business
      END,
      updated_at = NOW()
    FROM picked p
    WHERE lm.lid = p.lid
    RETURNING lm.lid
    `);
    console.log(`[APPLY] Updated lid_mappings rows: ${updatedRows.length}`);
}
async function main() {
    const applyMode = process.argv.includes('--apply');
    if (applyMode) {
        await applyBackfill();
    }
    else {
        await dryRun();
        console.log('Run with --apply to write changes.');
    }
}
main()
    .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
})
    .finally(async () => {
    await prismaClient_1.default.$disconnect();
});
