import prisma from "./prismaClient";

type UpsertChatOptions = {
  status?: string;
  participants?: any[];
};

// Kept for compatibility but performs no operation as Prisma manages schema
async function ensureChatColumns() {
  return Promise.resolve();
}

function DBHelper() {
  async function GetUser(token: string) {
    const user = await prisma.users.findFirst({
      where: { name: token },
    });
    if (!user) {
      console.warn(`GetUser: User not found for token/name: ${token}`);
      return null;
    }
    return user.jid ? user.jid.split(":")[0] : null;
  }

  async function upsertChat(
    id: string,
    lastMessage: string,
    lastMessageTime: Date,
    unreadCount: number | null | undefined,
    isOnline: boolean,
    isTyping: boolean,
    pushname: string,
    contactId: string,
    userId: string,
    statusOrOptions?: string | UpsertChatOptions | any[],
    isFromMe: boolean = false
  ) {
    const normalizedOptions = normalizeUpsertOptions(statusOrOptions);
    const status = normalizedOptions.status || "open";
    const participants =
      normalizedOptions.participants &&
        Array.isArray(normalizedOptions.participants)
        ? normalizedOptions.participants
        : undefined;

    // Prisma logic for complex Upsert
    // We fetch first to handle the conditional logic for unReadCount and pushname
    const existingChat = await prisma.chats.findUnique({
      where: { id },
    });

    const isTypingStr = isTyping ? "1" : "0";
    const participantsVal = participants ? participants : (existingChat?.participants ?? []);

    if (existingChat) {
      // Logic for unReadCount:
      // If unreadCount arg is provided (not null/undefined), use it.
      // Else if isFromMe is false, increment.
      // Else keep existing.
      let newUnReadCount = existingChat.unReadCount || 0;
      if (unreadCount !== null && unreadCount !== undefined) {
        newUnReadCount = unreadCount;
      } else if (!isFromMe) {
        newUnReadCount += 1;
      }

      // Logic for pushname:
      // Update if passed, not empty, and not from me.
      // SQL: WHEN EXCLUDED."pushname" IS NOT NULL AND EXCLUDED."pushname" <> '' AND $13 = FALSE
      let newPushname = existingChat.pushname;
      if (pushname && pushname !== "" && !isFromMe) {
        newPushname = pushname;
      }

      const updated = await prisma.chats.update({
        where: { id },
        data: {
          lastMessage,
          lastMessageTime,
          unReadCount: newUnReadCount,
          isOnline: isOnline,
          isTyping: isTypingStr,
          pushname: newPushname,
          contactId,
          userId,
          status: normalizedOptions.status || existingChat.status || "open",
          participants: participantsVal as any, // Cast to any to satisfy InputJsonValue if needed
        },
      });
      return [updated];
    } else {
      // Create new
      const created = await prisma.chats.create({
        data: {
          id,
          lastMessage,
          lastMessageTime,
          unReadCount:
            unreadCount !== null && unreadCount !== undefined
              ? unreadCount
              : isFromMe
                ? 0
                : 1, // If not provided and creating, default logic? SQL default is 0. But if implicit increment applies on create?
          // SQL INSERT VALUES used $4. If $4 was null, it would insert NULL?
          // Table definition unReadCount Int? @default(0).
          // If we pass NULL to create, it uses default? No, explicit null is null.
          // I will assume if passed null/undefined, we start with 1 if not from me, 0 if from me.
          isOnline,
          isTyping: isTypingStr,
          pushname,
          contactId,
          userId,
          status,
          participants: (participants || []) as any,
        },
      });
      return [created];
    }
  }

  async function upsertMessage(
    message: any,
    chatId: string,
    type: string,
    passedMediaPath?: string,
    userId?: string
  ) {
    let content =
      message.Message.conversation ||
      message.Message.extendedTextMessage?.text ||
      "";
    var contactId = "";
    let mediaPath: string | null =
      passedMediaPath || message.Info?.mediaPath || null;

    if (!message.isFromMe) {
      contactId = (message.Info.Sender || "").match(/^[^@:]+/)?.[0] || "";
    }

    // Determine media path based on message type if not already provided
    if (!mediaPath) {
      if (type == "sticker" || type == "image") {
        mediaPath = `imgs/${message.Info.ID}.webp`;
      } else if (type == "audio") {
        mediaPath = `audio/${message.Info.ID}.ogg`;
      } else if (type == "video") {
        mediaPath = `video/${message.Info.ID}.mp4`;
      }
    }

    // Extract replyToMessageId from various possible locations in the message object
    console.log('--- DB Upsert Message Debug ---');
    console.log('Full Message Object:', JSON.stringify(message, null, 2));
    console.log('Message ID:', message.Info?.ID);
    console.log('Message Type:', type);

    // Helper to find reply/quoted message ID recursively in an object
    const findReplyId = (obj: any): string | null => {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.stanzaId) return obj.stanzaId;
      if (obj.StanzaId) return obj.StanzaId;
      if (obj.quotedMessageId) return obj.quotedMessageId;
      if (obj.QuotedMessageId) return obj.QuotedMessageId;
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const res = findReplyId(obj[key]);
          if (res) return res;
        }
      }
      return null;
    };

    // Check various paths for the reply/quoted message ID
    const replyToMessageId =
      message.Info?.replyToMessageId ||
      message.Info?.replyToMessageID ||
      message.replyToMessageId ||
      message.forwardContext?.StanzaId ||
      findReplyId(message.Message) ||
      findReplyId(message) ||
      null;

    console.log('Identified replyToMessageId:', replyToMessageId);

    const messageData = {
      chatId,
      message: content,
      timeStamp: new Date(message.Info.Timestamp),
      isDelivered: false,
      isRead: false,
      messageType: type,
      isFromMe: message.Info.IsFromMe,
      contactId,
      isEdit: message.Info.isEdit || false, // Ensure boolean
      mediaPath,
      userId: userId || null,
      replyToMessageId,
    };

    try {
      const result = await prisma.messages.upsert({
        where: { id: message.Info.ID },
        update: {
          message: content,
          timeStamp: new Date(message.Info.Timestamp),
          isDelivered: false, // SQL updated these to EXCLUDED values which were defaulting to false?
          // Wait, SQL VALUES ($5, $6) were false, false.
          // UPDATE SET "isDelivered" = EXCLUDED."isDelivered" -> sets to false regardless?
          // Yes, the original code resets isDelivered/isRead on update?
          // Original SQL:
          // VALUES (..., false, false, ...)
          // UPDATE SET "isDelivered" = EXCLUDED."isDelivered"
          // So yes, it seems it resets them.
          isRead: false,
          messageType: type,
          isFromMe: message.Info.IsFromMe,
          contactId,
          isEdit: message.Info.isEdit || false,
          mediaPath,
          userId: userId || null,
          replyToMessageId,
        },
        create: {
          id: message.Info.ID,
          ...messageData,
        },
      });
      console.log("Upserted message:", result);
      return result;
    } catch (err) {
      console.error("Error upserting message:", err);
      throw err;
    }
  }

  async function GetPhoneNum(chatId: string) {
    const res = await prisma.whatsmeow_lid_map.findUnique({
      where: { lid: chatId },
    });
    return res?.pn;
  }

  async function upsertGroup(id: string, name: string) {
    try {
      // Prisma handles table creation via migrations, assuming table exists.
      const result = await prisma.groups.upsert({
        where: { id },
        update: { name },
        create: { id, name },
      });
      return result;
    } catch (error) {
      console.error("Error upserting group:", error);
      throw error;
    }
  }

  async function updateMessageStatus(
    messageIds: string[],
    status: "read" | "delivered"
  ) {
    if (!messageIds || messageIds.length === 0) return [];

    const isRead = status === "read";
    const isDelivered = status === "read" || status === "delivered";

    const dataToUpdate: any = {};
    if (isRead) dataToUpdate.isRead = true;
    if (isDelivered) dataToUpdate.isDelivered = true;

    try {
      // Prisma updateMany returns count, not rows.
      // To emulate returning rows, we fetch them after update or try to find them.
      // However, since we update by ID, we can fetch all with these IDs.
      await prisma.messages.updateMany({
        where: {
          id: { in: messageIds },
        },
        data: dataToUpdate,
      });

      const updatedMessages = await prisma.messages.findMany({
        where: {
          id: { in: messageIds },
        },
      });
      return updatedMessages;
    } catch (err) {
      console.error("Error updating message status:", err);
      throw err;
    }
  }

  return {
    GetUser,
    upsertChat,
    upsertMessage,
    GetPhoneNum,
    upsertGroup,
    updateMessageStatus,
  };
}

function normalizeUpsertOptions(
  statusOrOptions?: string | UpsertChatOptions | any[]
): UpsertChatOptions {
  if (Array.isArray(statusOrOptions)) {
    return { participants: statusOrOptions };
  }
  if (typeof statusOrOptions === "string") {
    return { status: statusOrOptions };
  }
  if (
    statusOrOptions &&
    typeof statusOrOptions === "object" &&
    !Array.isArray(statusOrOptions)
  ) {
    return {
      status: statusOrOptions.status,
      participants: statusOrOptions.participants,
    };
  }
  return {};
}

export default DBHelper;