import ChatMessageHandler from './ChatMessageHandler';
const { v4: uuidv4 } = require('uuid');
import DBHelper from './DBHelper';
import { emitChatPresence } from './SocketEmits';
interface HooksType {
  Message(obj: any): void;
  SyncHistory(obj: any): void;
  ChatPresence(obj: any): void;
  ReadReceipt(obj: any): void;
}


class processWhatsAppHooks implements HooksType {
  constructor(HookObj: any) {
    if (HookObj.type) {
      if ((HookObj).type == "HistorySync") this.SyncHistory(HookObj);
      if ((HookObj).type == "Message") this.Message(HookObj);
      else if ((HookObj).type == "ChatPresence") this.ChatPresence(HookObj);
      else if ((HookObj).type == "ReadReceipt") this.ReadReceipt(HookObj);
      else if ((HookObj).type == "Presence") this.Presence(HookObj);
    }
  }

  Message(obj: any): void {
    ChatMessageHandler().ChatMessageHandler(obj.event, obj.instanceName);
  }
  SyncHistory(obj: any): void {
    if (obj.event && obj.event.Data && obj.event.Data.conversations && obj.event.Data.syncType == 3) {
      var conversations = obj.event.Data.conversations.filter((a: any) => a.ID != "status@broadcast");
      conversations.forEach(async (con: any) => {
        await ChatMessageHandler().ChatupsertHelper(con, obj.instanceName);
      });

    }
  }

  ChatPresence(obj: any): void {
    try {
      if (obj.event && obj.event) {
        const presenceData = obj.event;
        const chatId = (presenceData.Chat || presenceData.Sender)?.match(/^[^@:]+/)?.[0] || "";
        const userId = presenceData.SenderAlt || presenceData.Sender?.match(/^[^@:]+/)?.[0] || "";

        // Extract presence information
        const isOnline = presenceData.State === 'available' || presenceData.State === 'online';
        const isTyping = presenceData.State === 'composing' || presenceData.State === 'recording';

        // Emit socket event for chat presence
        emitChatPresence({
          chatId: chatId,
          userId: userId,
          isOnline: isOnline,
          isTyping: isTyping
        });

        console.log(`Chat presence updated for ${chatId}: online=${isOnline}, typing=${isTyping}`);
      }
    } catch (error) {
      console.error('Error handling chat presence:', error);
    }
  }
  ReadReceipt(obj: any): void {
    if (obj.event && obj.event.MessageIDs) {
      ChatMessageHandler().handleMessageStatusUpdate(obj.event);
    }
  }
  Presence(obj: any): void {
  }
}
export default processWhatsAppHooks;