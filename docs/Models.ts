export interface ChatMessage {
    message: string;
    // legacy/backward-compatible: some code uses `timeStamp`, others use `timestamp`.
    // Keep both for compatibility. `timestamp` may be a string (ISO) or number in some flows.
    timeStamp: Date;
    timestamp?: string | number | Date;
    id: string;
    chatId: string;
    ContactId: string;
    messageType: string;
    isEdit: boolean;
    isRead: boolean;
    isDelivered: boolean;
    isFromMe: boolean;
    phone: string;
    pushName?: string; // Sender's display name
    mediaPath?: string; // File path for media messages (audio, images, videos)
    isPinned?: boolean;
    replyToMessageId?: string;
    replyToMessage?: ChatMessage;
    note?: string;
    editedAt?: Date;
    reactions?: MessageReaction[];
    seconds?: number;
    waveform?: number[];
}

export interface MessageReaction {
    id: string; // Optional since it might be aggregated
    messageId: string;
    userId: string;
    emoji: string;
    createdAt: Date;
    participant?: string;
    contactName?: string;
}
export interface Contact {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    state: string;
    zip: string;
    country: string;
    lastMessage: string;
    lastMessageTime: Date;
    unreadCount: number;
    isTyping: boolean;
    isOnline: boolean;
    Image: string;
    lastSeen: Date;
    ChatId: string;
    tags: ChatTag[];
}
export interface ChatTag {
    id: string;
    name: string;
    color: string;
    status: 'available' | 'reserved';
    createdAt: Date;
    updatedAt: Date;
}

export interface Chat {
    id: string;
    name: string;
    participants: string[];
    lastMessage: string;
    lastMessageTime: Date;
    unreadCount: number;
    isTyping: boolean;
    isOnline: boolean;
    messages: ChatMessage[];
    phone: string;
    contactId: string;
    pushname?: string; // Display name of the chat contact (from chats table)
    tags: ChatTag[];
    isArchived?: boolean;
    isMuted?: boolean;
    assignedTo?: string;
    status?: 'open' | 'closed';
    avatar?: string;
    reason?: string;
}
