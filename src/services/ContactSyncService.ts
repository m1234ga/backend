import { databaseService } from './DatabaseService';
import { createLogger } from '../utils/logger';

const logger = createLogger('ContactSyncService');

function jidToBare(jid: string): string {
    return (jid || '').split('@')[0] || '';
}

function ensureJid(value: string, suffix: string): string {
    const jid = (value || '').trim();
    if (!jid) return '';
    return jid.includes('@') ? jid : `${jid}${suffix}`;
}

export async function syncContactsFromWuzAPI(
    lidToPnMap?: Map<string, string>,
    phoneNumberToLidMappings?: any
): Promise<void> {
    try {
        let mappingUpdates = 0;

        if (Array.isArray(phoneNumberToLidMappings)) {
            for (const mapping of phoneNumberToLidMappings) {
                const lidJid = mapping?.lidJID || mapping?.lidJid || mapping?.lid;
                const pnJid = mapping?.pnJID || mapping?.pnJid || mapping?.pn;

                if (typeof lidJid !== 'string' || typeof pnJid !== 'string') continue;

                const lidFull = ensureJid(lidJid, '@lid');
                const pnFull = ensureJid(pnJid, '@s.whatsapp.net');
                const lidBare = jidToBare(lidFull);
                const phone = jidToBare(pnFull);

                if (!lidBare || !phone) continue;

                lidToPnMap?.set(lidFull, pnFull);
                lidToPnMap?.set(lidBare, pnFull);

                await databaseService.upsertLidMapping({
                    lid: lidBare,
                    phone,
                    fullName: mapping?.fullName || mapping?.FullName || null,
                    firstName: mapping?.firstName || mapping?.FirstName || null,
                    businessName: mapping?.businessName || mapping?.BusinessName || null,
                    pushName: mapping?.pushName || mapping?.PushName || null,
                    isMyContact: !!(mapping?.fullName || mapping?.FullName || mapping?.firstName || mapping?.FirstName),
                    isBusiness: !!(mapping?.businessName || mapping?.BusinessName),
                });

                const pendingContacts = await databaseService.consumePendingLidContacts(lidFull);
                for (const pending of pendingContacts) {
                    if (!phone) continue;

                    await databaseService.upsertLidMapping({
                        lid: lidBare,
                        phone,
                        fullName: pending.full_name || undefined,
                        firstName: pending.first_name || undefined,
                        pushName: pending.push_name || undefined,
                        businessName: pending.business_name || undefined,
                        isMyContact: !!(pending.full_name || pending.first_name),
                        isBusiness: !!pending.business_name,
                    });
                }

                mappingUpdates += 1;
            }
        }

        const contacts = await databaseService.getWhatsmeowContacts();
        if (!Array.isArray(contacts) || contacts.length === 0) {
            if (mappingUpdates > 0) {
                logger.info('WuzAPI mapping sync completed without contacts payload', {
                    mappingUpdates,
                });
            } else {
                logger.warn('Contacts sync skipped: no whatsmeow_contacts payload');
            }
            return;
        }

        let processed = 0;
        let unresolvedLids = 0;

        for (const contact of contacts) {
            const jid = String(contact.their_jid || '').trim();

            if (!jid) continue;

            const fullName = contact.full_name || null;
            const firstName = contact.first_name || null;
            const businessName = contact.business_name || null;
            const pushName = contact.push_name || null;
            const isMyContact = !!(fullName || firstName);
            const isBusiness = !!businessName;

            let lid: string | null = null;
            let phone: string | null = null;

            if (jid.endsWith('@s.whatsapp.net')) {
                const phoneBare = jidToBare(jid);
                if (!phoneBare) continue;

                phone = phoneBare;
                lid = await databaseService.getLidByPhoneJid(jid);
                if (!lid) {
                    lid = phoneBare;
                } else {
                    const phoneJid = ensureJid(phoneBare, '@s.whatsapp.net');
                    lidToPnMap?.set(ensureJid(lid, '@lid'), phoneJid);
                    lidToPnMap?.set(lid, phoneJid);
                }
            } else if (jid.endsWith('@lid')) {
                const lidBare = jidToBare(jid);
                if (!lidBare) continue;

                lid = lidBare;

                const mappedFromMemory = lidToPnMap?.get(jid) || lidToPnMap?.get(lidBare) || null;
                if (mappedFromMemory) {
                    phone = jidToBare(mappedFromMemory);
                }

                if (!phone) {
                    phone = await databaseService.resolveLid(lidBare);
                }

                if (phone) {
                    const phoneJid = ensureJid(phone, '@s.whatsapp.net');
                    lidToPnMap?.set(ensureJid(lidBare, '@lid'), phoneJid);
                    lidToPnMap?.set(lidBare, phoneJid);
                }

                if (!phone) {
                    unresolvedLids += 1;
                    await databaseService.upsertPendingLidContact({
                        lid: lidBare,
                        fullName: fullName || undefined,
                        firstName: firstName || undefined,
                        pushName: pushName || undefined,
                        businessName: businessName || undefined,
                    });
                    continue;
                }
            } else {
                continue;
            }

            if (!lid || !phone) {
                continue;
            }

            await databaseService.upsertLidMapping({
                lid,
                phone,
                fullName,
                firstName,
                businessName,
                pushName,
                isMyContact,
                isBusiness,
            });

            processed += 1;
        }

        logger.info('WuzAPI contacts sync completed', {
            mappingUpdates,
            totalContacts: contacts.length,
            processed,
            unresolvedLids,
        });
    } catch (error) {
        logger.error('Failed to sync contacts from WuzAPI', error);
    }
}
