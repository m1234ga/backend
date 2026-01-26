import MediaDownLoadHelper from "./MediaDownLoadHelper";
import DBHelper from "./DBHelper";
import { emitNewMessage, emitChatUpdate, emitMessageUpdate, emitReactionUpdate } from "./SocketEmits";
import { adjustToConfiguredTimezone } from "./utils/timezone";

interface NormalizedParticipant {
    jid: string;
    id: string;
    phone: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
    displayName?: string;
}

function ChatMessageHandler() {

    async function ChatMessageHandler(message: any, token: string) {
        // Adjust timestamp to configured timezone
        if (message?.Info?.Timestamp) {
            message.Info.Timestamp = adjustToConfiguredTimezone(new Date(message.Info.Timestamp)).toISOString();
        }

        // Skip broadcast status messages
        if (message?.Info?.Chat === "status@broadcast") {
            return;
        }

        const chatId = getChatId(message);

        // Handle Reaction Messages
        if (message.Message?.reactionMessage) {
            const reaction = message.Message.reactionMessage;
            const messageId = reaction.key?.ID; // The original message being reacted to
            const reactionPrimaryKey = message.Info.ID; // The unique ID of the reaction itself
            const participant = (reaction.key?.remoteJID || "").split("@")[0];
            const emoji = reaction.text;
            const createdAt = new Date(message.Info.Timestamp);

            try {
                // Ensure message exists or handle gracefully? 
                // For now, swapping ensures we target the right foreign key.
                await DBHelper().upsertReaction(
                    reactionPrimaryKey,
                    messageId,
                    participant,
                    emoji,
                    createdAt
                );

                // Fetch updated reactions for this message to emit
                const updatedReactions = await DBHelper().getMessageReactions(messageId);
                emitReactionUpdate(chatId, messageId, updatedReactions);
            } catch (err) {
                console.error("Error handling reaction hook:", err);
            }
            return;
        }

        let type = "text";
        const retrievedUserId = await DBHelper().GetUser(token);
        const userId = retrievedUserId || 'unknown'; // Fallback to avoid crash
        if (message.Message) {
            if (message.Message.imageMessage || message.Message.stickerMessage) {
                await MediaDownLoadHelper().saveImageBase64FromApi(message);
                if (message.Message.imageMessage) type = "image";
                else type = "sticker";
            } else if (message.Message.audioMessage) {
                await MediaDownLoadHelper().saveAudioFromApi(message);
                type = "audio";
            }
            if (
                message.Message.conversation ||
                message.Message.imageMessage ||
                message.Message.stickerMessage ||
                message.Message.audioMessage
            ) {
                const chatResult = await DBHelper().upsertChat(
                    chatId,
                    resolveMessagePreview(message.Message),
                    new Date(message.Info.Timestamp),
                    message.unreadCount,
                    false,
                    false,
                    message.Info.PushName,
                    message.Info.ID,
                    userId
                );
                const messageResult = await DBHelper().upsertMessage(
                    message,
                    chatId,
                    type
                );

                // Emit socket events for real-time updates
                if (messageResult) {
                    emitNewMessage(messageResult);
                }
                if (chatResult && chatResult.length > 0) {
                    emitChatUpdate(chatResult[0]);
                }
            }
            if (message.Message.extendedTextMessage) {
                const chatResult = await DBHelper().upsertChat(
                    chatId,
                    message.Message.extendedTextMessage.text,
                    new Date(message.Info.Timestamp),
                    message.unreadCount,
                    false,
                    false,
                    chatId,
                    message.Info.ID,
                    userId
                );
                const messageResult = await DBHelper().upsertMessage(
                    message,
                    chatId,
                    type
                );

                // Emit socket events for real-time updates
                if (messageResult) {
                    emitNewMessage(messageResult);
                }
                if (chatResult && chatResult.length > 0) {
                    emitChatUpdate(chatResult[0]);
                }


            }
        }
    }

    async function ChatupsertHelper(con: any, token: string) {
        const retrievedUserId = await DBHelper().GetUser(token);
        const userId = retrievedUserId || 'unknown'; // Fallback to avoid crash
        const isGroup = isGroupConversation(con);

        const groupParticipants = isGroup
            ? extractGroupParticipants(con)
            : undefined;
        const conversationId = (con.ID || con.id || "").split("@")[0] || "";
        const conversationTimestamp = normalizeConversationTimestamp(
            con.conversationTimestamp
        );
        // If it's a group (check original Chat JID), upsert to groups table
        if (isGroup) {
            await DBHelper().upsertGroup(conversationId, con?.name || con?.Name);
        }
        const unreadCount =
            typeof con.unreadCount === "number" ? con.unreadCount : 0;
        const pushName = resolveConversationName(con);
        const latestMessage = getLatestConversationMessage(con);
        const lastMessagePreview = latestMessage
            ? resolveMessagePreview(latestMessage.message?.message)
            : "";

        if (conversationTimestamp && unreadCount >= 0) {
            await DBHelper().upsertChat(
                conversationId,
                lastMessagePreview || "",
                adjustToConfiguredTimezone(new Date(conversationTimestamp)),
                unreadCount,
                false,
                false,
                pushName,
                con.ID,
                userId,
                {
                    participants: groupParticipants,
                }
            );
        }

        if (Array.isArray(con.messages) && con.messages.length > 0) {
            con.messages
                .sort(
                    (a: any, b: any) => Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0)
                )
                .forEach(async (message: any) => {
                    if (!message?.message?.messageTimestamp || !message?.message?.key) {
                        return;
                    }
                    message.Info = {
                        Chat: message.message.key.remoteJID,
                        Timestamp: new Date(
                            Number(message.message.messageTimestamp) * 1000
                        ).toUTCString(),
                        ID: message.message.key.ID,
                        IsFromMe: message.message.key.fromMe,
                        SenderAlt: message.message.key.participant,
                        PushName:
                            message.pushname ||
                            message.message?.pushName ||
                            resolveConversationName(con),
                    };
                    message.Message = message.message.message;
                    await ChatMessageHandler(message, token);
                });
        }
    }
    function getChatId(message: any) {
        const source = (!message.Info.IsFromMe && message.Info.SenderAlt && !message.Info.IsGroup)
            ? message.Info.Sender
            : message.Info.Chat;

        return source?.match(/^[^@:]+/)?.[0] || "";
    }

    async function handleMessageStatusUpdate(event: any) {
        const messageIds = event.MessageIDs;
        if (!messageIds || messageIds.length === 0) return;

        const type = event.Type; // 'read', 'delivered', etc.
        const status: 'read' | 'delivered' = type === 'read' ? 'read' : 'delivered';

        const updatedMessages = await DBHelper().updateMessageStatus(messageIds, status);

        // Emit socket updates for each updated message to refresh UI checkmarks
        updatedMessages.forEach(msg => {
            emitMessageUpdate(msg);
        });
    }

    return {
        ChatMessageHandler,
        ChatupsertHelper,
        handleMessageStatusUpdate,
    };
}

function resolveMessagePreview(content: any): string {
    if (!content) return "";
    if (content.conversation) return content.conversation;
    if (content.extendedTextMessage?.text)
        return content.extendedTextMessage.text;
    if (content.imageMessage) return "[Image]";
    if (content.videoMessage) return "[Video]";
    if (content.stickerMessage) return "[Sticker]";
    if (content.audioMessage) return "[Audio]";
    if (content.documentMessage?.title)
        return `[Document] ${content.documentMessage.title}`;
    return "";
}

function isGroupConversation(con: any): boolean {
    const id = con?.ID || con?.id || con?.jid || "";
    return typeof id === "string" && id.includes("@g.us");
}

function extractGroupParticipants(con: any): NormalizedParticipant[] {
    const metadata =
        con?.groupMetadata ||
        con?.GroupMetadata ||
        con?.metadata ||
        con?.groupInfo ||
        {};
    let rawParticipants =
        metadata?.participants ||
        metadata?.Participants ||
        metadata?.members ||
        metadata?.member ||
        con?.participants ||
        [];

    if (rawParticipants && typeof rawParticipants === "object") {
        if (!Array.isArray(rawParticipants)) {
            rawParticipants = Object.values(rawParticipants);
        }
    } else if (!Array.isArray(rawParticipants)) {
        rawParticipants = [];
    }

    const normalized = (rawParticipants as any[])
        .map(normalizeParticipantEntry)
        .filter((participant): participant is NormalizedParticipant => !!participant);

    const unique = new Map<string, NormalizedParticipant>();
    normalized.forEach((participant) => {
        if (!unique.has(participant.jid)) {
            unique.set(participant.jid, participant);
        } else {
            const existing = unique.get(participant.jid)!;
            unique.set(participant.jid, {
                ...existing,
                isAdmin: existing.isAdmin || participant.isAdmin,
                isSuperAdmin: existing.isSuperAdmin || participant.isSuperAdmin,
                displayName: existing.displayName || participant.displayName,
            });
        }
    });

    return Array.from(unique.values());
}

function normalizeParticipantEntry(entry: any): NormalizedParticipant | null {
    if (!entry) return null;
    let jid: string | undefined;
    let displayName: string | undefined;

    if (typeof entry === "string") {
        jid = entry;
    } else if (typeof entry === "object") {
        if (typeof entry.id === "string") {
            jid = entry.id;
        } else if (entry.id && typeof entry.id === "object") {
            const user = entry.id.user || entry.id.local || entry.id.phone;
            const server = entry.id.server || entry.id.domain || "s.whatsapp.net";
            if (user) {
                jid = `${user}@${server}`;
            }
        } else if (typeof entry.jid === "string") {
            jid = entry.jid;
        } else if (typeof entry.participant === "string") {
            jid = entry.participant;
        } else if (entry.wid) {
            if (typeof entry.wid === "string") {
                jid = entry.wid;
            } else if (entry.wid.user) {
                jid = `${entry.wid.user}@${entry.wid.server || "s.whatsapp.net"}`;
            }
        }
        displayName =
            entry.name ||
            entry.displayName ||
            entry.pushName ||
            entry.notify ||
            entry.fullName;
    }

    if (!jid) return null;
    const phone = stripJid(jid);
    const adminFlag = typeof entry === "object" ? entry.admin : undefined;
    const isAdmin =
        adminFlag === "admin" ||
        adminFlag === "superadmin" ||
        entry?.isAdmin === true;
    const isSuperAdmin =
        adminFlag === "superadmin" || entry?.isSuperAdmin === true;

    return {
        jid,
        id: phone,
        phone,
        isAdmin: !!isAdmin,
        isSuperAdmin: !!isSuperAdmin,
        displayName,
    };
}

function stripJid(jid: string): string {
    if (!jid) return "";
    return jid.split("@")[0] || jid;
}

function resolveConversationName(con: any): string {
    return (
        con?.Name ||
        con?.name ||
        con?.PushName ||
        con?.pushName ||
        con?.subject ||
        con?.groupMetadata?.subject ||
        con?.GroupMetadata?.subject ||
        ""
    );
}

function normalizeConversationTimestamp(timestamp: any): number | null {
    if (timestamp === null || timestamp === undefined) {
        return null;
    }
    const value = Number(timestamp);
    if (Number.isNaN(value) || value <= 0) {
        return null;
    }
    // Most HistorySync timestamps are seconds; if the value looks like seconds, convert.
    return value < 10_000_000_000 ? value * 1000 : value;
}

function getLatestConversationMessage(con: any): any | null {
    if (!Array.isArray(con?.messages) || con.messages.length === 0) {
        return null;
    }
    return [...con.messages].sort(
        (a: any, b: any) => Number(b.msgOrderID || 0) - Number(a.msgOrderID || 0)
    )[0];
}

export default ChatMessageHandler;