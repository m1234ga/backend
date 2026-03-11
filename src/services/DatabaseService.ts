import prisma from '../../prismaClient';
import wuzPool from '../../WuzDBConnection';
import { createLogger } from '../utils/logger';
import { sanitizeChatId, sanitizePhone } from '../validation/schemas';

const logger = createLogger('DatabaseService');

export interface UpsertChatOptions {
    status?: string;
    participants?: any[];
    incrementUnreadOnIncoming?: boolean;
}

export interface MessageData {
    id: string;
    chatId: string;
    message: string;
    timestamp: Date | string;
    messageType: string;
    isFromMe: boolean;
    contactId?: string;
    mediaPath?: string;
    userId?: string;
    replyToMessageId?: string;
    status?: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface UpsertLidMappingInput {
    lid: string;
    phone?: string | null;
    fullName?: string | null;
    firstName?: string | null;
    businessName?: string | null;
    pushName?: string | null;
    isMyContact?: boolean;
    isBusiness?: boolean;
}

/**
 * Database service - Singleton pattern
 * Handles all database operations with proper error handling and logging
 */
class DatabaseService {
    private static instance: DatabaseService;

    private constructor() {
        logger.info('DatabaseService initialized');
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    private normalizeJid(value: string, suffix: string): string {
        const trimmed = (value || '').trim();
        if (!trimmed) return '';
        return trimmed.includes('@') ? trimmed : `${trimmed}${suffix}`;
    }

    private normalizeLidKey(value: string): string {
        return (value || '').trim().replace(/@lid$/i, '');
    }

    private jidToPhone(value: string): string {
        return (value || '').split('@')[0] || '';
    }

    // Accept ISO strings at service boundaries and coerce once at DB write time.
    private toDate(value: Date | string): Date {
        if (value instanceof Date) return value;
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    /**
     * Get user JID from token/name
     */
    async getUserJid(token: string): Promise<string | null> {
        try {
            const result = await wuzPool.query(
                'SELECT jid FROM users WHERE token = $1 LIMIT 1',
                [token]
            );
            const user = (result.rows?.[0] as { jid: string | null } | undefined) || null;

            if (!user) {
                logger.warn('User not found', { token });
                return null;
            }

            return user.jid ? user.jid.split(':')[0] : null;
        } catch (error) {
            logger.error('Failed to get user JID', error, { token });
            throw error;
        }
    }

    /**
     * Upsert chat with proper transaction handling
     */
    async upsertChat(
        id: string,
        lastMessage: string,
        lastMessageTime: Date | string,
        unreadCount: number | null | undefined,
        isOnline: boolean,
        isTyping: boolean,
        pushname: string,
        contactId: string,
        userId: string,
        options?: UpsertChatOptions,
        isFromMe: boolean = false
    ): Promise<any> {
        const sanitizedId = sanitizeChatId(id);
        const status = options?.status || 'open';
        const incrementUnreadOnIncoming = options?.incrementUnreadOnIncoming === true;
        const participants = options?.participants || [];

        try {
            const normalizedLastMessageTime = this.toDate(lastMessageTime);
            const contactRaw = (contactId || '').toString();
            const contactBare = sanitizePhone(contactRaw || '');
            const candidateIds = new Set<string>([sanitizedId]);
            let canonicalId = sanitizedId;
            const incomingIsLid = (id || '').includes('@lid') || contactRaw.includes('@lid');

            if (incomingIsLid) {
                // Keep chat identity on LID to match message chatId handling.
                const normalizedLid = this.normalizeLidKey(contactRaw || id);
                canonicalId = sanitizeChatId(normalizedLid) || canonicalId;
                candidateIds.add(canonicalId);
            } else {
                if (contactBare) {
                    canonicalId = sanitizeChatId(contactBare) || canonicalId;
                    candidateIds.add(canonicalId);

                    const mappedLid = await this.getLidByPhoneJid(`${contactBare}@s.whatsapp.net`);
                    if (mappedLid) {
                        candidateIds.add(sanitizeChatId(mappedLid));
                    }
                }
            }

            let existingChat: {
                id: string;
                unReadCount: number | null;
                pushname: string | null;
                participants: any;
                contactId: string | null;
            } | null = null;

            const orderedLookupIds = [canonicalId, ...Array.from(candidateIds).filter(cid => cid !== canonicalId)];
            for (const lookupId of orderedLookupIds) {
                if (!lookupId) continue;

                const found = await prisma.chats.findUnique({
                    where: { id: lookupId },
                    select: { id: true, unReadCount: true, pushname: true, participants: true, contactId: true },
                });

                if (found) {
                    existingChat = found;
                    break;
                }
            }

            const targetChatId = existingChat?.id || canonicalId;

            const isTypingStr = isTyping ? '1' : '0';
            const participantsVal = participants.length > 0 ? participants : (existingChat?.participants ?? []);

            if (existingChat) {
                // Calculate new unread count
                let newUnReadCount = existingChat.unReadCount || 0;
                if (unreadCount !== null && unreadCount !== undefined) {
                    newUnReadCount = unreadCount;
                } else if (!isFromMe && incrementUnreadOnIncoming) {
                    newUnReadCount += 1;
                }

                // Update pushname only if provided and not from me
                const newPushname = (pushname && pushname !== '' && !isFromMe)
                    ? pushname
                    : existingChat.pushname;

                const updated = await prisma.chats.update({
                    where: { id: targetChatId },
                    data: {
                        lastMessage,
                        lastMessageTime: normalizedLastMessageTime,
                        unReadCount: newUnReadCount,
                        isOnline,
                        isTyping: isTypingStr,
                        pushname: newPushname,
                        contactId: contactId || existingChat.contactId || existingChat.pushname,
                        userId,
                        status,
                        participants: participantsVal as any,
                    },
                });

                logger.debug('Chat updated', { chatId: targetChatId, canonicalId });
                return [updated];
            } else {
                // Create new chat
                const created = await prisma.chats.create({
                    data: {
                        id: canonicalId,
                        lastMessage,
                        lastMessageTime: normalizedLastMessageTime,
                        unReadCount: unreadCount !== null && unreadCount !== undefined
                            ? unreadCount
                            : (!isFromMe && incrementUnreadOnIncoming ? 1 : 0),
                        isOnline,
                        isTyping: isTypingStr,
                        pushname: (!isFromMe && pushname && pushname !== '') ? pushname : '',
                        contactId,
                        userId,
                        status,
                        participants: participantsVal as any,
                    },
                });

                logger.info('Chat created', { chatId: canonicalId });
                return [created];
            }
        } catch (error) {
            logger.error('Failed to upsert chat', error, { chatId: sanitizedId });
            throw error;
        }
    }

    /**
     * Upsert message with proper validation
     */
    async upsertMessage(messageData: MessageData): Promise<any> {
        try {
            const sanitizedChatId = sanitizeChatId(messageData.chatId);
            const normalizedTimestamp = this.toDate(messageData.timestamp);
            const rawContactId = (messageData.contactId || '').split('@')[0];
            const sanitizedContactId = sanitizePhone(rawContactId || '') || rawContactId || null;
            const initialStatus = messageData.status || (messageData.isFromMe ? 'sent' : 'read');
            const isDelivered = initialStatus === 'delivered' || initialStatus === 'read';
            const isRead = initialStatus === 'read';

            const rows = await prisma.$queryRawUnsafe<any[]>(
                `
                INSERT INTO messages (
                    id, "chatId", message, "timeStamp", "isDelivered", "isRead", "messageType", "isFromMe", "contactId", "isEdit", "mediaPath", "userId", "replyToMessageId", status
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $12, $13
                )
                ON CONFLICT (id) DO UPDATE SET
                    message = EXCLUDED.message,
                    "timeStamp" = EXCLUDED."timeStamp",
                    "messageType" = EXCLUDED."messageType",
                    "isFromMe" = EXCLUDED."isFromMe",
                    "contactId" = COALESCE(EXCLUDED."contactId", messages."contactId"),
                    "isEdit" = false,
                    "mediaPath" = EXCLUDED."mediaPath",
                    "userId" = EXCLUDED."userId",
                    "replyToMessageId" = EXCLUDED."replyToMessageId",
                    status = CASE
                        WHEN messages.status = 'failed' THEN 'failed'
                        WHEN messages.status = 'read' THEN 'read'
                        WHEN messages.status = 'delivered' AND EXCLUDED.status = 'read' THEN 'read'
                        WHEN messages.status = 'sent' AND EXCLUDED.status IN ('delivered', 'read') THEN EXCLUDED.status
                        WHEN messages.status IS NULL THEN COALESCE(EXCLUDED.status, 'sent')
                        ELSE messages.status
                    END,
                    "isDelivered" = CASE
                        WHEN messages."isDelivered" = true THEN true
                        WHEN EXCLUDED.status IN ('delivered', 'read') THEN true
                        ELSE COALESCE(messages."isDelivered", false)
                    END,
                    "isRead" = CASE
                        WHEN messages."isRead" = true THEN true
                        WHEN EXCLUDED.status = 'read' THEN true
                        ELSE COALESCE(messages."isRead", false)
                    END
                RETURNING *
                `,
                messageData.id,
                sanitizedChatId,
                messageData.message,
                normalizedTimestamp,
                isDelivered,
                isRead,
                messageData.messageType,
                messageData.isFromMe,
                sanitizedContactId,
                messageData.mediaPath || null,
                messageData.userId || null,
                messageData.replyToMessageId || null,
                initialStatus
            );

            const result = rows?.[0];

            logger.debug('Message upserted', { messageId: messageData.id });
            return result;
        } catch (error) {
            logger.error('Failed to upsert message', error, { messageId: messageData.id });
            throw error;
        }
    }

    /**
     * Update message status (read/delivered)
     */
    async updateMessageStatus(
        messageIds: string[],
                status: 'read' | 'delivered'
    ): Promise<any[]> {
        if (!messageIds || messageIds.length === 0) return [];

        try {
                        const updatedMessages = await prisma.$queryRawUnsafe<any[]>(
                                `
                                UPDATE messages
                                SET
                                    status = CASE
                                        WHEN status = 'failed' THEN 'failed'
                                        WHEN status = 'read' THEN 'read'
                                        WHEN status = 'delivered' AND $2 = 'read' THEN 'read'
                                        WHEN status = 'sent' AND $2 IN ('delivered', 'read') THEN $2
                                        WHEN status IS NULL THEN $2
                                        ELSE status
                                    END,
                                    "isDelivered" = CASE
                                        WHEN "isDelivered" = true THEN true
                                        WHEN $2 IN ('delivered', 'read') THEN true
                                        ELSE COALESCE("isDelivered", false)
                                    END,
                                    "isRead" = CASE
                                        WHEN "isRead" = true THEN true
                                        WHEN $2 = 'read' THEN true
                                        ELSE COALESCE("isRead", false)
                                    END
                                WHERE id = ANY($1::varchar[])
                                RETURNING *
                                `,
                                messageIds,
                                status
                        );

            logger.debug('Message status updated', { count: updatedMessages.length, status });
            return updatedMessages;
        } catch (error) {
            logger.error('Failed to update message status', error, { messageIds, status });
            throw error;
        }
    }

    async incrementUnreadCount(chatId: string): Promise<number> {
        const sanitizedId = sanitizeChatId(chatId);
        try {
            const rows = await prisma.$queryRawUnsafe<Array<{ unReadCount: number }>>(
                `
                UPDATE chats
                SET "unReadCount" = COALESCE("unReadCount", 0) + 1
                WHERE id = $1
                RETURNING "unReadCount"
                `,
                sanitizedId
            );
            return rows[0]?.unReadCount ?? 0;
        } catch (error) {
            logger.error('Failed to increment unread count', error, { chatId: sanitizedId });
            throw error;
        }
    }

    async resetUnreadCount(chatId: string): Promise<number> {
        const sanitizedId = sanitizeChatId(chatId);
        try {
            const rows = await prisma.$queryRawUnsafe<Array<{ unReadCount: number }>>(
                `
                UPDATE chats
                SET "unReadCount" = 0
                WHERE id = $1
                RETURNING "unReadCount"
                `,
                sanitizedId
            );
            return rows[0]?.unReadCount ?? 0;
        } catch (error) {
            logger.error('Failed to reset unread count', error, { chatId: sanitizedId });
            throw error;
        }
    }

    /**
     * Upsert reaction
     */
    async upsertReaction(
        id: string,
        messageId: string,
        participant: string,
        emoji: string,
        createdAt: Date | string
    ): Promise<any> {
        try {
            const normalizedCreatedAt = this.toDate(createdAt);
            const result = await prisma.message_reactions.upsert({
                where: { id },
                update: { messageId, participant, emoji, createdAt: normalizedCreatedAt },
                create: { id, messageId, participant, emoji, createdAt: normalizedCreatedAt },
            });

            logger.debug('Reaction upserted', { reactionId: id, messageId });
            return result;
        } catch (error) {
            logger.error('Failed to upsert reaction', error, { reactionId: id, messageId });
            throw error;
        }
    }

    /**
     * Get message reactions with contact names
     */
    async getMessageReactionsWithNames(messageId: string): Promise<any[]> {
        try {
            const reactions = await prisma.$queryRawUnsafe(`
        SELECT 
          mr.id, 
          mr."messageId", 
          mr.participant, 
          mr.emoji, 
          mr."createdAt",
          COALESCE(cc.first_name, cc.full_name, cc.push_name, cc.business_name, mr.participant) as "contactName"
        FROM message_reactions mr
        LEFT JOIN cleaned_contacts cc ON SPLIT_PART(mr.participant, '@', 1) = cc.phone
        WHERE mr."messageId" = $1
        ORDER BY mr."createdAt" ASC
      `, messageId);

            return reactions as any[];
        } catch (error) {
            logger.error('Failed to get message reactions', error, { messageId });
            throw error;
        }
    }

    /**
     * Upsert cleaned contact
     */
    async upsertCleanedContact(
        phone: string,
        pushName?: string,
        chatId?: string
    ): Promise<any> {
        const cleanPhone = sanitizePhone(phone);

        try {
            const updateData: any = {};
            if (pushName) updateData.push_name = pushName;
            if (chatId) updateData.chatId = chatId;

            const result = await prisma.cleaned_contacts.upsert({
                where: { phone: cleanPhone },
                update: updateData,
                create: {
                    phone: cleanPhone,
                    push_name: pushName || null,
                    chatId: chatId || null,
                } as any,
            });

            logger.debug('Cleaned contact upserted', { phone: cleanPhone });
            return result;
        } catch (error) {
            logger.error('Failed to upsert cleaned contact', error, { phone: cleanPhone });
            throw error;
        }
    }

    async upsertCleanedContactDetails(params: {
        phone: string;
        chatId?: string;
        fullName?: string;
        firstName?: string;
        pushName?: string;
        businessName?: string;
    }): Promise<any> {
        const cleanPhone = sanitizePhone(params.phone);
        if (!cleanPhone) return null;

        const updateData: any = {
            ...(params.chatId ? { chatId: params.chatId } : {}),
            ...(params.firstName ? { first_name: params.firstName } : {}),
            ...(params.fullName ? { full_name: params.fullName } : {}),
            ...(params.pushName ? { push_name: params.pushName } : {}),
            ...(params.businessName ? { business_name: params.businessName } : {}),
        };

        try {
            const result = await prisma.cleaned_contacts.upsert({
                where: { phone: cleanPhone },
                update: updateData,
                create: {
                    phone: cleanPhone,
                    chatId: params.chatId || null,
                    first_name: params.firstName || null,
                    full_name: params.fullName || null,
                    push_name: params.pushName || null,
                    business_name: params.businessName || null,
                } as any,
            });

            logger.debug('Detailed cleaned contact upserted', { phone: cleanPhone });
            return result;
        } catch (error) {
            logger.error('Failed to upsert detailed cleaned contact', error, { phone: cleanPhone });
            throw error;
        }
    }

    async resolveContactName(phone: string): Promise<{
        displayName: string;
        isMyContact: boolean;
        isBusiness: boolean;
    } | null> {
        const cleanPhone = sanitizePhone(phone || '');
        if (!cleanPhone) return null;

        try {
            const rows = await prisma.$queryRawUnsafe<Array<{
                phone: string;
                full_name: string | null;
                first_name: string | null;
                business_name: string | null;
                push_name: string | null;
                is_my_contact: boolean | null;
                is_business: boolean | null;
            }>>(
                `
                SELECT phone, full_name, first_name, business_name, push_name, is_my_contact, is_business
                FROM lid_mappings
                WHERE phone = $1
                ORDER BY updated_at DESC
                LIMIT 1
                `,
                cleanPhone
            );

            const row = rows[0];
            if (!row) return null;

            const displayName = row.full_name || row.first_name || row.business_name || row.push_name || cleanPhone;
            return {
                displayName,
                isMyContact: !!row.is_my_contact,
                isBusiness: !!row.is_business,
            };
        } catch (error) {
            logger.error('Failed to resolve contact name from lid_mappings', error, { phone: cleanPhone });
            throw error;
        }
    }

    async upsertLidMapping(input: UpsertLidMappingInput): Promise<void> {
        const lid = this.normalizeLidKey(input.lid);
        const phone = input.phone
            ? sanitizePhone(this.jidToPhone(this.normalizeJid(input.phone, '@s.whatsapp.net')))
            : null;
        if (!lid) return;

        const fullName = input.fullName ?? null;
        const firstName = input.firstName ?? null;
        const businessName = input.businessName ?? null;
        const pushName = input.pushName ?? null;
        const isMyContact = input.isMyContact ?? !!(fullName || firstName);
        const isBusiness = input.isBusiness ?? !!businessName;

        try {
            await prisma.$executeRawUnsafe(
                `
                INSERT INTO lid_mappings (
                  lid, phone, full_name, first_name, business_name, push_name, is_my_contact, is_business, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (lid)
                DO UPDATE SET
                                    phone = COALESCE(EXCLUDED.phone, lid_mappings.phone),
                  full_name = COALESCE(EXCLUDED.full_name, lid_mappings.full_name),
                  first_name = COALESCE(EXCLUDED.first_name, lid_mappings.first_name),
                  business_name = COALESCE(EXCLUDED.business_name, lid_mappings.business_name),
                  push_name = COALESCE(EXCLUDED.push_name, lid_mappings.push_name),
                                    is_my_contact = COALESCE(EXCLUDED.is_my_contact, lid_mappings.is_my_contact),
                                    is_business = COALESCE(EXCLUDED.is_business, lid_mappings.is_business),
                  updated_at = NOW()
                `,
                lid,
                phone,
                fullName,
                firstName,
                businessName,
                pushName,
                isMyContact,
                isBusiness
            );
        } catch (error) {
            logger.error('Failed to upsert lid mapping', error, { lid, phone });
            throw error;
        }
    }

    async getLidByPhoneJid(phoneOrJid: string): Promise<string | null> {
        const pnJid = this.normalizeJid(phoneOrJid, '@s.whatsapp.net');
        const pnBare = sanitizePhone(this.jidToPhone(pnJid));
        if (!pnBare) return null;

        try {
            const rows = await prisma.$queryRawUnsafe<Array<{ lid: string }>>(
                `
                SELECT lid
                FROM lid_mappings
                WHERE phone = $1
                  AND lid <> $1
                ORDER BY updated_at DESC
                LIMIT 1
                `,
                pnBare
            );

            if (rows[0]?.lid) {
                return this.normalizeLidKey(rows[0].lid);
            }

            const legacyResult = await wuzPool.query(
                'SELECT lid FROM whatsmeow_lid_map WHERE pn = $1 OR pn = $2 LIMIT 1',
                [pnJid, pnBare]
            );
            const legacy = (legacyResult.rows?.[0] as { lid: string | null } | undefined) || null;

            return legacy?.lid ? this.normalizeLidKey(legacy.lid) : null;
        } catch (error) {
            logger.error('Failed to resolve lid by phone jid', error, { pnJid, pnBare });
            throw error;
        }
    }

    async getPhoneFromLidMappings(lidJid: string): Promise<string | null> {
        const lid = this.normalizeLidKey(lidJid);
        if (!lid) return null;

        try {
            const dbRows = await prisma.$queryRawUnsafe<Array<{ phone: string }>>(
                `SELECT phone FROM lid_mappings WHERE lid IN ($1, $2) LIMIT 1`,
                lid,
                `${lid}@lid`
            );

            if (Array.isArray(dbRows) && dbRows[0]?.phone) {
                return dbRows[0].phone;
            }

            const legacyResult = await wuzPool.query(
                'SELECT pn FROM whatsmeow_lid_map WHERE lid = $1 OR lid = $2 LIMIT 1',
                [lid, `${lid}@lid`]
            );
            const legacy = (legacyResult.rows?.[0] as { pn: string | null } | undefined) || null;

            return legacy?.pn ? this.jidToPhone(legacy.pn) : null;
        } catch (error) {
            logger.error('Failed to get phone from lid mappings', error, { lid });
            throw error;
        }
    }

    async resolveLid(lidOrBare: string): Promise<string | null> {
        return this.getPhoneFromLidMappings(lidOrBare);
    }

    async upsertPendingLidContact(params: {
        lid: string;
        chatId?: string;
        fullName?: string;
        firstName?: string;
        pushName?: string;
        businessName?: string;
    }): Promise<void> {
        const lid = this.normalizeLidKey(params.lid);
        if (!lid) return;

        try {
            await prisma.$executeRawUnsafe(
                `
                INSERT INTO pending_lid_contacts (lid, chat_id, full_name, first_name, push_name, business_name, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (lid)
                DO UPDATE SET
                  chat_id = COALESCE(EXCLUDED.chat_id, pending_lid_contacts.chat_id),
                  full_name = COALESCE(EXCLUDED.full_name, pending_lid_contacts.full_name),
                  first_name = COALESCE(EXCLUDED.first_name, pending_lid_contacts.first_name),
                  push_name = COALESCE(EXCLUDED.push_name, pending_lid_contacts.push_name),
                  business_name = COALESCE(EXCLUDED.business_name, pending_lid_contacts.business_name),
                  updated_at = NOW()
                `,
                lid,
                params.chatId || null,
                params.fullName || null,
                params.firstName || null,
                params.pushName || null,
                params.businessName || null
            );
        } catch (error) {
            logger.error('Failed to upsert pending lid contact', error, { lid });
            throw error;
        }
    }

    async consumePendingLidContacts(lidJid: string): Promise<Array<{
        lid: string;
        chat_id: string | null;
        full_name: string | null;
        first_name: string | null;
        push_name: string | null;
        business_name: string | null;
    }>> {
        const lid = this.normalizeLidKey(lidJid);
        if (!lid) return [];

        try {
            const pending = await prisma.$queryRawUnsafe<Array<{
                lid: string;
                chat_id: string | null;
                full_name: string | null;
                first_name: string | null;
                push_name: string | null;
                business_name: string | null;
            }>>(
                `SELECT lid, chat_id, full_name, first_name, push_name, business_name FROM pending_lid_contacts WHERE lid = $1`,
                lid
            );

            if (pending.length > 0) {
                await prisma.$executeRawUnsafe(`DELETE FROM pending_lid_contacts WHERE lid = $1`, lid);
            }

            return pending;
        } catch (error) {
            logger.error('Failed to consume pending lid contacts', error, { lid });
            throw error;
        }
    }

    async getWhatsmeowContacts(ourJid?: string): Promise<Array<{
        their_jid: string;
        first_name: string | null;
        full_name: string | null;
        push_name: string | null;
        business_name: string | null;
    }>> {
        try {
            if (ourJid) {
                const result = await wuzPool.query(
                    `
                    SELECT their_jid, first_name, full_name, push_name, business_name
                    FROM whatsmeow_contacts
                    WHERE our_jid LIKE '%' || $1 || '%' OR our_jid = $1
                    `,
                    [ourJid]
                );
                console.log('[getWhatsmeowContacts] ourJid result:', result.rows);
                return result.rows as Array<{
                    their_jid: string;
                    first_name: string | null;
                    full_name: string | null;
                    push_name: string | null;
                    business_name: string | null;
                }>;
            }

            const result = await wuzPool.query(
                'SELECT their_jid, first_name, full_name, push_name, business_name FROM whatsmeow_contacts'
            );
            console.log('[getWhatsmeowContacts] all result:', result.rows);
            return result.rows as Array<{
                their_jid: string;
                first_name: string | null;
                full_name: string | null;
                push_name: string | null;
                business_name: string | null;
            }>;
        } catch (error) {
            logger.error('Failed to load whatsmeow contacts', error, { ourJid });
            throw error;
        }
    }

    /**
     * Upsert group
     */
    async upsertGroup(id: string, name: string): Promise<any> {
        try {
            const result = await prisma.groups.upsert({
                where: { id },
                update: { name },
                create: { id, name },
            });

            logger.debug('Group upserted', { groupId: id });
            return result;
        } catch (error) {
            logger.error('Failed to upsert group', error, { groupId: id });
            throw error;
        }
    }

    /**
     * Get phone number from LID map
     */
    async getPhoneFromLid(chatId: string): Promise<string | undefined> {
        try {
            const result = await wuzPool.query(
                'SELECT pn FROM whatsmeow_lid_map WHERE lid = $1 OR lid = $2 LIMIT 1',
                [chatId, this.normalizeLidKey(chatId)]
            );
            const res = (result.rows?.[0] as { pn: string | undefined } | undefined) || undefined;
            return res?.pn;
        } catch (error) {
            logger.error('Failed to get phone from LID', error, { chatId });
            throw error;
        }
    }
}

// Export singleton instance
export const databaseService = DatabaseService.getInstance();
