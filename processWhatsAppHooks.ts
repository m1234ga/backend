import { databaseService } from './src/services/DatabaseService';
import { socketHandler } from './src/handlers/SocketHandler';
import { createLogger } from './src/utils/logger';
import { CONFIG } from './src/config';
import { whatsAppApiService } from './src/services/WhatsAppApiService';
import { syncContactsFromWuzAPI } from './src/services/ContactSyncService';
import { adjustToConfiguredTimezone } from './src/utils/timezone';
import { SOCKET_EVENTS } from './src/constants';
import fs from 'fs';
import path from 'path';

const logger = createLogger('WhatsAppHooks');
let cachedUserJid: string | null = null;
let cachedUserJidPromise: Promise<string> | null = null;

interface HooksType {
  Message(obj: any): Promise<void>;
  SyncHistory(obj: any): Promise<void>;
  ChatPresence(obj: any): Promise<void>;
  ReadReceipt(obj: any): Promise<void>;
}

class ProcessWhatsAppHooks implements HooksType {
  private userJid: string = 'system';
  private lidToPnMap: Map<string, string> = new Map();

  // private constructor — can't be called directly
  private constructor() {}

  // static async factory — caller can await this
  static async create(HookObj: any): Promise<void> {
    const instance = new ProcessWhatsAppHooks();
    await instance.initializeUser();
    await instance.handleWebhook(HookObj);
  }

  private async initializeUser() {
    try {
      if (cachedUserJid) {
        this.userJid = cachedUserJid;
        return;
      }

      if (!cachedUserJidPromise) {
        cachedUserJidPromise = (async () => {
          const jid = await databaseService.getUserJid(CONFIG.WUZAPI.TOKEN);
          return jid || 'system';
        })();
      }

      const resolvedJid = await cachedUserJidPromise;
      cachedUserJid = resolvedJid;
      this.userJid = resolvedJid;
    } catch (err) {
      logger.error('Failed to initialize user JID', err);
      this.userJid = cachedUserJid || 'system';
    }
  }


  private ensureJid(value: string, suffix: string): string {
    const jid = (value || '').trim();
    if (!jid) return '';
    return jid.includes('@') ? jid : `${jid}${suffix}`;
  }

  private jidToPhone(value: string): string {
    return (value || '').split('@')[0] || '';
  }

  private sanitizeLid(value: string): string {
    return (value || '').trim().split('@')[0] || '';
  }
  private normalizeTimestamp(raw: any): string {
    if (!raw) return adjustToConfiguredTimezone(new Date()).toISOString();

    const num = Number(raw);
    if (Number.isNaN(num) || num <= 0) return adjustToConfiguredTimezone(new Date()).toISOString();

    const seconds = num > 9_999_999_999 ? Math.floor(num / 1000) : num;
    return adjustToConfiguredTimezone(new Date(seconds * 1000)).toISOString();
  }

  // ... rest of methods

  async handleWebhook(HookObj: any) {
    try {
      if (HookObj.type) {
        if (HookObj.type == "HistorySync") await this.SyncHistory(HookObj);
        else if (HookObj.type == "Message") await this.Message(HookObj);
        else if (HookObj.type == "ChatPresence") await this.ChatPresence(HookObj);
        else if (HookObj.type == "ReadReceipt") await this.ReadReceipt(HookObj);
        else if (HookObj.type == "Presence") this.Presence(HookObj);
      }
    } catch (err) {
      logger.error('Error processing webhook', err);
    }
  }

  async Message(obj: any): Promise<void> {
    try {
      const event = obj.event;
      if (!event || !event.Info) return;
      if (obj.event?.Info?.Chat === "status@broadcast") return;

      await this.processSingleMessage(event.Info, event.Message, true);
    } catch (err) {
      logger.error('Error processing Message webhook', err);
    }
  }

  /**
   * Unified message logic: Handles a single message from webhook or history sync
   */
  private async processSingleMessage(info: any, message: any, isLiveMessage: boolean = false): Promise<void> {
    try {
      // 0. Skip broadcast status messages
      if (info.Chat === "status@broadcast") {
        return;
      }

      // 0b. Determine IDs and names using specialized logic
      const { chatId, phoneRaw, pushName } = await this.getChatId(info);

      // 1. Determine basic info (Mirrors old implementation)
      // For reaction webhooks, messageId must point to the reacted message.
      const reactionTargetMessageId = message?.reactionMessage?.key?.ID || message?.reactionMessage?.key?.id;
      const messageId = reactionTargetMessageId || info.ID || info.id;
      const isFromMe = info.IsFromMe || false;
      const timestamp = this.normalizeTimestamp(info.Timestamp || info.timeStamp);
      const isGroup = (info.Chat || "").includes("@g.us");

      let contactId = (info.ContactId || '').toString();
      if (!contactId) {
        if (isFromMe) {
          contactId = (this.userJid || '').split('@')[0] || 'Me';
        } else {
          contactId = (phoneRaw || '').split('@')[0] || '';
        }
      }

      // 2. Determine message type and content
      let messageType = 'text';
      let content = '';
      let mediaPath = undefined;
      let replyToMessageId = undefined;

      // Context info for replies
      const contextInfo = message.extendedTextMessage?.contextInfo ||
        message.imageMessage?.contextInfo ||
        message.videoMessage?.contextInfo ||
        message.audioMessage?.contextInfo ||
        message.documentMessage?.contextInfo ||
        message.stickerMessage?.contextInfo ||
        message.locationMessage?.contextInfo ||
        message.contactMessage?.contextInfo ||
        message.pollMessage?.contextInfo;

      if (contextInfo && (contextInfo.stanzaId||contextInfo.stanzaID) ) {
        replyToMessageId = contextInfo.stanzaId||contextInfo.stanzaID;
      }

      if (message.conversation) {
        content = message.conversation;
      } else if (message.extendedTextMessage) {
        content = message.extendedTextMessage.text;
      } else if (message.hydratedContentText) {
        content = message.hydratedContentText;
      } else if (message.imageMessage) {
        messageType = 'image';
        content = message.imageMessage.caption || '[Image]';
        mediaPath = await this.handleMediaDownload(message.imageMessage, 'image', messageId);
      } else if (message.videoMessage) {
        messageType = 'video';
        content = message.videoMessage.caption || '[Video]';
        mediaPath = await this.handleMediaDownload(message.videoMessage, 'video', messageId);
      } else if (message.audioMessage) {
        messageType = 'audio';
        content = '[Audio]';
        mediaPath = await this.handleMediaDownload(message.audioMessage, 'audio', messageId);
      } else if (message.documentMessage) {
        messageType = 'document';
        content = message.documentMessage.fileName || '[Document]';
        mediaPath = await this.handleMediaDownload(message.documentMessage, 'document', messageId);
      } else if (message.stickerMessage) {
        messageType = 'sticker';
        content = '[Sticker]';
        mediaPath = await this.handleMediaDownload(message.stickerMessage, 'sticker', messageId);
      } else if (message.locationMessage) {
        messageType = 'location';
        const locMsg = message.locationMessage;
        const lat = locMsg.degreesLatitude ?? locMsg.latitude ?? 0;
        const lng = locMsg.degreesLongitude ?? locMsg.longitude ?? 0;
        const name = locMsg.name || '';
        content = `[Location] ${lat.toFixed(4)},${lng.toFixed(4)}${name ? ` (${name})` : ''}`;
      } else if (message.contactMessage) {
        messageType = 'contact';
        const contactMsg = message.contactMessage;
        const displayName = contactMsg.displayName || 'Contact';
        const rawVcard = contactMsg.vcard || contactMsg.Vcard || '';
        const telMatch = String(rawVcard).match(/TEL[^:]*:([^\r\n]+)/i);
        const contactPhone = telMatch ? telMatch[1].replace(/[\s-]/g, '').trim() : '';
        content = `[Contact] ${displayName}${contactPhone ? `|${contactPhone}` : ''}`;
      } else if (message.pollMessage) {
        messageType = 'poll';
        const pollMsg = message.pollMessage;
        const pollName = pollMsg.name || 'Poll';
        content = `[Poll] ${pollName}`;
      }

      // Reaction-only webhook: do not upsert chat/message content.
      if (message.reactionMessage) {
        try {
          const reaction = message.reactionMessage;
          const targetMessageId = reaction.key?.ID || reaction.key?.id;
          const reactionId = info.ID || info.id;
          const participant = (reaction.key?.remoteJID || reaction.key?.participant || info.Sender || info.Participant || "").split("@")[0];
          const emoji = reaction.text;
          const reactionTimestamp = this.normalizeTimestamp(info.Timestamp || info.timeStamp || Date.now());

          if (targetMessageId && reactionId && emoji) {
            await databaseService.upsertReaction(reactionId, targetMessageId, participant, emoji, reactionTimestamp);

            const updatedReactions = await databaseService.getMessageReactionsWithNames(targetMessageId);
            const reactionPayload = { chatId, messageId: targetMessageId, reactions: updatedReactions };
            const io = socketHandler.getIO();

            // Webhook chatId can be a phone/LID variant; emit globally and to likely rooms.
            io?.emit(SOCKET_EVENTS.REACTION_UPDATED, reactionPayload);

            if (chatId) {
              io?.to(`conversation_${chatId}`).emit(SOCKET_EVENTS.REACTION_UPDATED, reactionPayload);

              const normalizedChatId = this.jidToPhone(String(chatId || ''));
              if (normalizedChatId && normalizedChatId !== chatId) {
                io?.to(`conversation_${normalizedChatId}`).emit(SOCKET_EVENTS.REACTION_UPDATED, reactionPayload);
              }
            }
          }
        } catch (err) {
          // Ignore P2003 (FK error if message doesn't exist yet)
          if ((err as any).code !== 'P2003') {
            logger.error('Error handling reaction', err);
          }
        }
        return;
      }

      // 3. Upsert Chat
      const unreadCount = typeof info.unreadCount === "number" ? info.unreadCount : undefined;
      const updatedChats = await databaseService.upsertChat(
        chatId,
        content,
        timestamp,
        unreadCount,
        true, // isOnline
        false, // isTyping
        pushName,
        contactId,
        this.userJid,
        { incrementUnreadOnIncoming: isLiveMessage, callerFunctionName: 'processSingleMessage' }, // options
        isFromMe
      );

      // 4. Upsert Message
      const messageContactId = isFromMe
        ? (cachedUserJid || this.userJid || 'Me')
        : contactId;
        logger.debug('Upserting message', { messageId, chatId, contactId: messageContactId, isFromMe, content, mediaPath });
      const savedMessage = await databaseService.upsertMessage({
        id: messageId,
        chatId,
        message: content,
        timestamp,
        messageType,
        isFromMe,
        contactId: messageContactId,
        status: isFromMe ? 'sent' : 'read',
        mediaPath,
        userId: isFromMe ? 'Me' : undefined,
        replyToMessageId
      });
      const unreadValue = updatedChats?.[0]?.unReadCount;

      // 6. Emit to Socket
      const io = socketHandler.getIO();
      if (io) {
        io.emit(SOCKET_EVENTS.NEW_MESSAGE, {
          ...savedMessage,
          pushName
        });

        const dbChat = updatedChats?.[0];
        const emittedPushName = dbChat?.pushname || pushName;
        const emittedUnread = dbChat?.unReadCount ?? unreadValue ?? 0;
        const emittedPhone = this.jidToPhone(String(dbChat?.phone || phoneRaw || contactId || chatId || ''));
        const emittedContactId = isGroup
          ? this.jidToPhone(String(dbChat?.contactId || contactId || chatId || ''))
          : this.jidToPhone(String(phoneRaw || dbChat?.phone || contactId || dbChat?.contactId || chatId || ''));

        logger.debug('Emitting chat_updated', {
          chatId: dbChat?.id || chatId,
          unread: emittedUnread,
          pushName: emittedPushName,
          hasDbChat: Boolean(dbChat)
        });

        // Emit a richer chat payload so clients can upsert new chats and refresh names immediately.
        io.emit(SOCKET_EVENTS.CHAT_UPDATED, {
          ...(dbChat || {}),
          id: dbChat?.id || chatId,
          name: dbChat?.name || emittedPushName || chatId,
          lastMessage: dbChat?.lastMessage || content,
          lastMessageTime: dbChat?.lastMessageTime || timestamp,
          phone: emittedPhone || chatId,
          contactId: emittedContactId || chatId,
          pushname: emittedPushName,
          pushName: emittedPushName,
          unread_count: emittedUnread,
          unreadCount: emittedUnread,
        });
      }

    } catch (err) {
      logger.error('Error processing single message', err, { id: info?.ID });
    }
  }

  /**
   * Determine the true chatId and phone using local LID mappings and local DB only.
   */
private async getChatId(info: any) {  
  const isGroup = (info.Chat || "").includes("@g.us");

  let source = "";
  let phoneRaw = "";
  let pushName = info.PushName || "";

  if (!isGroup) {
    ({ source, phoneRaw } = await this.resolveDirectChatSource(info));
  } else {
    ({ source, phoneRaw } = this.resolveGroupSource(info));
  }

  // normalize sender
  if (phoneRaw) info.Sender = phoneRaw;
  if (pushName) info.PushName = pushName;

  const chatId = isGroup
    ? source?.match(/^[^@:]+/)?.[0] || ""
    : this.sanitizeLid(source || phoneRaw);

  const phone = phoneRaw.includes("@s.whatsapp.net")
    ? this.jidToPhone(phoneRaw)
    : "";

  if (phone) {
    pushName = await this.resolveAndStoreContact(phone, pushName, chatId);
  }

  phoneRaw = phoneRaw?.match(/^[^@:]+/)?.[0] || "";

  return { chatId, phoneRaw, pushName };
}
private resolveGroupSource(info: any) {
  const source = info.Chat || info.RemoteJid || info.Sender || "";

  let phoneRaw = info.Sender || info.Participant || "";

  if (!info.Sender?.includes("@s.whatsapp.net")) {
    phoneRaw = info.SenderAlt || info.Sender;
  }

  return { source, phoneRaw };
}
private async resolveDirectChatSource(info: any) {
  let source = "";
  let phoneRaw = "";

  if (!info.IsFromMe) {
    if (info.SenderAlt?.includes("@s.whatsapp.net")) {
      source = info.Sender;
      phoneRaw = info.SenderAlt;
    }

    else if (info.Sender?.endsWith("@lid")) {
      const resolved = await this.resolvePhoneJidFromLid(info.Sender);
      phoneRaw = resolved || info.SenderAlt;
      source = info.Sender;
    }

    else if (info.Sender?.includes("@s.whatsapp.net")) {
      source = info.SenderAlt;
      phoneRaw = info.Sender;
    }

    else {
      source = info.Sender;
      phoneRaw = info.SenderAlt;
    }
  }

  else {
    if ((info.RecipientAlt || "").includes("@lid")) {
      source = info.RecipientAlt;
      phoneRaw = (info.Chat || "").includes("@s.whatsapp.net")
        ? info.Chat
        : info.Sender;
    }

    else if (info.Sender?.includes("@s.whatsapp.net")) {
      source = info.Chat || info.RemoteJid || info.Sender || "";
      phoneRaw = info.Sender;
    }

    else if (info.SenderAlt?.includes("@lid")) {
      source = info.SenderAlt || info.Chat || info.RemoteJid || "";
      phoneRaw = info.Sender || info.SenderAlt;
    }

    else {
      source = info.Chat || info.RemoteJid || info.Sender || "";
      phoneRaw = info.SenderAlt || info.Sender;
    }
  }

  return { source, phoneRaw };
}
private async resolveAndStoreContact(phone: string, pushName: string, chatId: string) {

  const resolved = await databaseService.resolveContactName(phone);

  if (resolved?.displayName) {
    pushName = resolved.displayName;
  } 
  else if (!pushName) {
    pushName = phone;
  }

  await databaseService.upsertLidMapping({
    lid: chatId || phone,
    phone,
    pushName,
    fullName: null,
    firstName: null,
    businessName: null,
    isMyContact: false,
    isBusiness: false,
  });

  return pushName;
}
  private async handleMediaDownload(mediaMsg: any, type: 'image' | 'video' | 'audio' | 'document' | 'sticker', messageId: string): Promise<string | undefined> {
    try {
      const mediaInfo = {
        URL: mediaMsg.URL,
        directPath: mediaMsg.directPath,
        mediaKey: mediaMsg.mediaKey,
        mimetype: mediaMsg.mimetype,
        fileEncSHA256: mediaMsg.fileEncSha256 || mediaMsg.fileEncSHA256,
        fileSHA256: mediaMsg.fileSha256 || mediaMsg.fileSHA256,
        fileLength: mediaMsg.fileLength
      };

      let result;
      let extension = '';
      let folder = '';

      if (type === 'image') {
        result = await whatsAppApiService.downloadImage(mediaInfo);
        extension = '.jpg';
        folder = CONFIG.PATHS.IMAGES;
      } else if (type === 'sticker') {
        result = await whatsAppApiService.downloadImage(mediaInfo);
        extension = '.webp';
        folder = CONFIG.PATHS.IMAGES;
      } else if (type === 'video') {
        result = await whatsAppApiService.downloadVideo(mediaInfo);
        extension = '.mp4';
        folder = CONFIG.PATHS.VIDEOS;
      } else if (type === 'audio') {
        result = await whatsAppApiService.downloadAudio(mediaInfo);
        extension = '.ogg';
        folder = CONFIG.PATHS.AUDIO;
      } else {
        result = await whatsAppApiService.downloadDocument(mediaInfo);
        extension = path.extname(mediaMsg.fileName || '') || '.bin';
        folder = CONFIG.PATHS.DOCUMENTS;
      }

      if (result && result.success && result.data) {
        const base64Data = result.data.data.Data || result.data.data;
        if (!base64Data || typeof base64Data !== 'string') return undefined;

        let cleanBase64 = '';
        if (type === 'image' || type === 'sticker') {
          cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        } else {
          cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        }

        if (!cleanBase64) return undefined;

        if (!fs.existsSync(folder)) {
          fs.mkdirSync(folder, { recursive: true });
        }

        const filename = `${type}_${messageId}${extension}`;
        const filePath = path.join(folder, filename);

        fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));

        const relativeFolder = (type === 'image' || type === 'sticker')
          ? 'imgs'
          : type === 'video'
            ? 'video'
            : type === 'audio'
              ? 'audio'
              : 'docs';
        return `${relativeFolder}/${filename}`;
      }
    } catch (err) {
      logger.error(`Failed to download ${type}`, err);
    }
    return undefined;
  }

  async SyncHistory(obj: any): Promise<void> {
    try {
      const event = obj.event;
      if (!event || !event.Data) return;

      const data = event.Data;
  
      // CRITICAL: syncType check from old code
      const VALID_SYNC_TYPES = new Set([0]); // BOOTSTRAP, FULL, RECENT, ON_DEMAND
            if(data.phoneNumberToLidMappings )
            await this.cachePhoneNumberToLidMappings(data.phoneNumberToLidMappings);

      if (!VALID_SYNC_TYPES.has(data.syncType)) {
        return logger.debug(`Skipping HistorySync with syncType ${data.syncType}`);
      }
      if (!Array.isArray(data.conversations)) return;

      logger.info(`Processing History Sync for ${data.conversations.length} conversations`);

      const conversations = data.conversations.filter((c: any) => {
        const conversationId = c?.ID || c?.id || c?.jid || '';
        return conversationId !== 'status@broadcast'
          && !conversationId.endsWith('@broadcast')
          && !conversationId.endsWith('@newsletter');
      });

      logger.info(`SyncType ${data.syncType}: received ${data.conversations.length} conversations, processed ${conversations.length}`);
      for (const con of conversations) {
        await this.processConversation(con);
      }

    } catch (err) {
      logger.error('Error processing SyncHistory', err);
    }
  }


  /**
   * Process a single conversation from HistorySync (Adapts ChatupsertHelper)
   */
  private async processConversation(con: any): Promise<void> {
    try {
      const id = con.accountLid||con.id || con.ID || con.jid;
      if (!id) return;

      const conversationId = id.split('@')[0];
      const isGroup = id.includes('@g.us');

      // 1. Group Upsert
      if (isGroup) {
        const subject = con.subject || con.name || con.Name;
        if (subject) {
          await databaseService.upsertGroup(conversationId, subject);
        }
      }

      // 2. Prep Info for Chat Upsert
      const unreadCount = typeof con.unreadCount === "number" ? con.unreadCount : 0;
      const pushName = this.resolveConversationName(con);
      const conversationTimestamp = this.normalizeTimestamp(con.conversationTimestamp);
      const latestMessage = this.getLatestConversationMessage(con);
      const lastMessagePreview = latestMessage ? this.resolveMessagePreview(latestMessage.message?.message) : "";
      const participants = isGroup ? this.extractGroupParticipants(con) : undefined;

      if (!isGroup) {
        const fullName = con.Name || con.name || null;
        const firstName = con.FirstName || con.firstName || null;
        const businessName = con.BusinessName || con.businessName || null;
        const profilePushName = con.PushName || con.pushName || null;
        const phone=con.pnJID.split('@')[0] || '';
        if (phone) {
          await databaseService.upsertLidMapping({
            lid: id,
            phone,
            fullName,
            firstName,
            businessName,
            pushName: profilePushName,
            isMyContact: !!(fullName || firstName),
            isBusiness: !!businessName,
          });
        }
      }

      // 3. Upsert Chat (Parity with old ChatupsertHelper)
      if (unreadCount >= 0) {
        await databaseService.upsertChat(
          conversationId,
          lastMessagePreview || "",
          conversationTimestamp,
          unreadCount,
          false, // isOnline
          false, // isTyping
          pushName,
          id, // original contactId
          this.userJid,
          { participants, callerFunctionName: 'processConversation' },
          id.includes('@s.whatsapp.net') && con.messages?.[0]?.message?.key?.fromMe // approximate isFromMe
        );
      }

      // 4. Process individual messages
      if (Array.isArray(con.messages) && con.messages.length > 0) {
        const sortedMessages = [...con.messages].sort((a: any, b: any) =>
          Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0)
        );

        for (const msg of sortedMessages) {
          const messageWrapper = msg.message;
          const key = messageWrapper?.key;
          if (!messageWrapper?.messageTimestamp || !key) continue;

          const groupMessage = id.includes('@g.us');
          const senderJid = id.split('@')[0] || '';
          const senderBare = senderJid.split('@')[0] || '';
          const senderAlt =con.pnJID;

          let contactId =key.remoteJID.split('@')[0] || '';
          if (key.fromMe) {
            contactId = (this.userJid || '').split('@')[0] || 'Me';
          } else if (groupMessage) {
            const mapped = this.lidToPnMap.get(senderJid)
              || this.lidToPnMap.get(senderBare);
            const resolved = mapped?.split('@')[0]
              || await databaseService.resolveLid(senderBare);
            contactId = resolved || senderBare;
          } else {
            const altJid = await this.resolveSenderAltFromMappings(senderJid, key.remoteJID || id);
            contactId = (altJid || '').split('@')[0] || senderBare;
          }

          // Construct standard Info block expected by processSingleMessage
          const info = {
            Chat: id,
            Timestamp: messageWrapper.messageTimestamp,
            ID: key.ID,
            IsFromMe: key.fromMe,
            Sender: id,
            SenderAlt: senderAlt,
            ContactId: contactId,
            PushName: msg.pushname || messageWrapper.pushName || con.pushName || con.subject,
            unreadCount // pass it along
          };

          const coreMessage = messageWrapper.message; // Actual content

          if (!coreMessage || (!coreMessage.conversation && !coreMessage.extendedTextMessage &&
            !coreMessage.imageMessage && !coreMessage.videoMessage &&
            !coreMessage.audioMessage && !coreMessage.documentMessage &&
            !coreMessage.stickerMessage && !coreMessage.locationMessage &&
            !coreMessage.contactMessage && !coreMessage.pollMessage &&
            !coreMessage.reactionMessage)) {
            continue;
          }

          await this.processSingleMessage(info, coreMessage);
        }
      }
    } catch (err) {
      logger.error('Error processing conversation history', err);
    }
  }

  // --- Helpers for parity with old architecture ---

  private resolveConversationName(con: any): string {
    return (
      con?.Name ||
      con?.name ||
      con?.PushName ||
      con?.pushName ||
      con?.subject ||
      ""
    );
  }

  private async cachePhoneNumberToLidMappings(mappings: any): Promise<void> {
    await syncContactsFromWuzAPI(this.lidToPnMap, mappings);
  }

  private async resolvePhoneJidFromLid(lidJid: string): Promise<string | null> {
    const lidFull = this.ensureJid(lidJid, '@lid');
    const lidBare = lidFull.split('@')[0];

    const fromMemory = this.lidToPnMap.get(lidFull) || this.lidToPnMap.get(lidBare);
    if (fromMemory) {
      return this.ensureJid(fromMemory, '@s.whatsapp.net');
    }

    const fromDb = await databaseService.getPhoneFromLidMappings(lidFull);
    if (!fromDb) return null;
    const resolved = this.ensureJid(fromDb, '@s.whatsapp.net');

    this.lidToPnMap.set(lidFull, resolved);
    this.lidToPnMap.set(lidBare, resolved);
    return resolved;
  }

  private async resolveSenderAltFromMappings(senderJid: string, fallbackJid: string): Promise<string> {
    const sender = senderJid || "";
    const fallback = fallbackJid || "";

    const mapped = this.lidToPnMap.get(sender) ||
      this.lidToPnMap.get(sender.split('@')[0]) ||
      this.lidToPnMap.get(fallback) ||
      this.lidToPnMap.get(fallback.split('@')[0]);

    if (mapped) return mapped;

    if (sender.endsWith('@lid')) {
      const senderResolved = await this.resolvePhoneJidFromLid(sender);
      if (senderResolved) return senderResolved;
    }

    if (fallback.endsWith('@lid')) {
      const fallbackResolved = await this.resolvePhoneJidFromLid(fallback);
      if (fallbackResolved) return fallbackResolved;
    }

    return mapped || fallback || sender;
  }

  private getLatestConversationMessage(con: any): any | null {
    if (!Array.isArray(con?.messages) || con.messages.length === 0) return null;
    return [...con.messages].sort(
      (a: any, b: any) => Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0)
    )[0];
  }

  private resolveMessagePreview(content: any): string {
    if (!content) return "";
    if (content.conversation) return content.conversation;
    if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
    if (content.imageMessage) return "[Image]";
    if (content.videoMessage) return "[Video]";
    if (content.audioMessage) return "[Audio]";
    if (content.stickerMessage) return "[Sticker]";
    if (content.locationMessage) {
      const lat = content.locationMessage.degreesLatitude ?? content.locationMessage.latitude;
      const lng = content.locationMessage.degreesLongitude ?? content.locationMessage.longitude;
      return typeof lat === 'number' && typeof lng === 'number' ? `[Location] ${lat},${lng}` : "[Location]";
    }
    if (content.contactMessage) return `[Contact] ${content.contactMessage.displayName || 'Contact'}`;
    if (content.pollMessage) return `[Poll] ${content.pollMessage.name || 'Poll'}`;
    if (content.documentMessage) return `[Document] ${content.documentMessage.fileName || 'File'}`;
    return "";
  }

  private extractGroupParticipants(con: any): any[] {
    const participants = con.participants || con.groupMetadata?.participants || [];
    if (!Array.isArray(participants)) return [];
    return participants.map((p: any) => ({
      jid: p.id || p.jid || p.participant,
      isAdmin: p.admin === 'admin' || p.admin === 'superadmin' || !!p.isAdmin,
      displayName: p.name || p.displayName || p.pushName
    }));
  }

  async ChatPresence(obj: any): Promise<void> {
    try {
      if (obj.event) {
        const presenceData = obj.event;
        const chatId = (presenceData.Chat || presenceData.Sender)?.match(/^[^@:]+/)?.[0] || "";
        const userId = presenceData.Sender?.match(/^[^@:]+/)?.[0] || "";

        const isOnline = presenceData.State === 'available' || presenceData.State === 'online';
        const isTyping = presenceData.State === 'composing' || presenceData.State === 'recording';

        // Emit via socketHandler
        const io = socketHandler.getIO();
        if (io) {
          io.emit(SOCKET_EVENTS.CHAT_PRESENCE, {
            chatId,
            userId,
            isOnline,
            isTyping
          });
          logger.debug(`Chat presence updated for ${chatId}: online=${isOnline}, typing=${isTyping}`);
        }
      }
    } catch (error) {
      logger.error('Error handling chat presence', error);
    }
  }

  async ReadReceipt(obj: any): Promise<void> {
    const event = obj.event;
    if (event && event.MessageIDs) {
      try {
        const numericType = Number(event.Type);
        const isReadType = numericType === 1 || numericType === 2;
        const status: 'read' | 'delivered' = isReadType ? 'read' : 'delivered';

        const updatedMessages = await databaseService.updateMessageStatus(event.MessageIDs, status);
        const eventChatId = (event.Chat || '').split('@')[0] || '';
        let unreadValue: number | null = null;

        if (isReadType && eventChatId) {
          unreadValue = await databaseService.resetUnreadCount(eventChatId);
        }

        // Emit socket updates to refresh UI checkmarks
        const io = socketHandler.getIO();
        if (io) {
          updatedMessages.forEach(msg => {
            io.emit(SOCKET_EVENTS.MESSAGE_UPDATED, msg);
          });

          if (isReadType && eventChatId) {
            io.emit(SOCKET_EVENTS.CHAT_UPDATED, {
              id: eventChatId,
              unread_count: unreadValue ?? 0,
              unreadCount: unreadValue ?? 0
            });
          }
        }
        logger.debug('Updated read/delivered status', { count: updatedMessages.length, status, eventType: numericType });
      } catch (error) {
        logger.error('Error updating read receipt', error);
      }
    }
  }

  Presence(obj: any): void {
    // Usually legacy/placeholder in wuzapi hooks
  }
}

export default async function (obj: any) {
  await ProcessWhatsAppHooks.create(obj);
}