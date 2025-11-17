import ChatMessageHandler  from './ChatMessageHandler';
const { v4: uuidv4 } = require('uuid');
import DBHelper from './DBHelper';
import { emitChatPresence } from './SocketEmits';
interface HooksType {
    Message(obj:any): void;
    SyncHistory(obj:any): void;
    ChatPresence(obj:any):void;
  }

    
class  processWhatsAppHooks implements HooksType {
    constructor(HookObj:any){
      if(HookObj.type){
        if((HookObj).type=="HistorySync")this.SyncHistory(HookObj);
        if((HookObj).type=="Message")this.Message(HookObj);
        else if((HookObj).type=="ChatPresence")this.ChatPresence(HookObj);
        else if((HookObj).type=="Presence")this.Presence(HookObj);
      }
    }
    
    Message(obj:any): void {
       ChatMessageHandler().ChatMessageHandler(obj.event,obj.instanceName);
    }
    SyncHistory(obj:any): void {
      if (obj.event && obj.event.Data && obj.event.Data.conversations && obj.event.Data.syncType==3) {
        var conversations=obj.event.Data.conversations.filter((a:any)=>a.ID!="status@broadcast");
      conversations.forEach( async(con:any)=> {
        await ChatMessageHandler().ChatupsertHelper(con,obj.instanceName);
      });

    }
    }

    ChatPresence(obj:any): void {
      try {
        if (obj.event && obj.event.Data) {
          const presenceData = obj.event.Data;
          const chatId = presenceData.chatId || presenceData.jid;
          const userId = presenceData.userId || presenceData.jid?.split('@')[0];
          
          // Extract presence information
          const isOnline = presenceData.state === 'available' || presenceData.state === 'online';
          const isTyping = presenceData.state === 'composing' || presenceData.state === 'recording';
          
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
    Presence(obj:any): void {
    }
  }
  export default processWhatsAppHooks;