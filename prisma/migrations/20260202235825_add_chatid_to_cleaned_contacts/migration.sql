-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(255),
    "last_name" VARCHAR(255),
    "role" VARCHAR(50) DEFAULT 'user',
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatAssignmentDetail" (
    "chatId" VARCHAR(50),
    "assignedTo" VARCHAR(50),
    "assignedBy" VARCHAR(50),
    "chatAssignmentDetailId" BIGSERIAL NOT NULL,
    "assignedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ChatAssignmentDetail_pkey" PRIMARY KEY ("chatAssignmentDetailId")
);

-- CreateTable
CREATE TABLE "chatTags" (
    "tagId" BIGSERIAL NOT NULL,
    "chatTagId" BIGSERIAL NOT NULL,
    "chatId" VARCHAR(50),
    "creationDate" DATE,
    "createdBy" TEXT,

    CONSTRAINT "Pkey" PRIMARY KEY ("chatTagId")
);

-- CreateTable
CREATE TABLE "chat_status_details" (
    "id" SERIAL NOT NULL,
    "chat_id" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "changed_by" VARCHAR(255),
    "changed_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "notes" TEXT,

    CONSTRAINT "chat_status_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatparticipants" (
    "chatid" VARCHAR(50) NOT NULL,
    "contactid" VARCHAR(50) NOT NULL,

    CONSTRAINT "chatparticipants_pkey" PRIMARY KEY ("chatid","contactid")
);

-- CreateTable
CREATE TABLE "chats" (
    "id" VARCHAR(100) NOT NULL,
    "lastMessage" TEXT,
    "lastMessageTime" TIMESTAMP(6),
    "unReadCount" INTEGER DEFAULT 0,
    "isOnline" BOOLEAN DEFAULT false,
    "contactId" VARCHAR(50),
    "isTyping" BIT(1),
    "userId" VARCHAR(50),
    "pushname" TEXT,
    "assignedTo" VARCHAR(50),
    "isarchived" BOOLEAN DEFAULT false,
    "ismuted" BOOLEAN DEFAULT false,
    "status" TEXT,
    "closedAt" TIME(6),
    "closeReason" TEXT,
    "participants" JSONB DEFAULT '[]',
    "avatar" TEXT,
    "isPinned" BOOLEAN,

    CONSTRAINT "chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaned_contacts" (
    "phone" TEXT NOT NULL,
    "first_name" TEXT,
    "full_name" TEXT,
    "push_name" TEXT,
    "business_name" TEXT,
    "chatId" VARCHAR(50),

    CONSTRAINT "cleaned_contacts_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "phone" VARCHAR(50),
    "email" VARCHAR(255),
    "address" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "zip" VARCHAR(20),
    "country" VARCHAR(100),
    "lastMessage" TEXT,
    "lastMessageTime" TIMESTAMP(6),
    "unReadCount" INTEGER DEFAULT 0,
    "isTyping" BOOLEAN DEFAULT false,
    "isOnline" BOOLEAN DEFAULT false,
    "image" TEXT,
    "lastSeen" TIMESTAMP(6),
    "chatId" VARCHAR(100),
    "contactId" VARCHAR(50),
    "userId" VARCHAR(50),
    "tags" JSONB DEFAULT '[]',

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100),
    "is_group" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messageTemplates" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedat" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "imagePath" TEXT,
    "mediaPath" TEXT,

    CONSTRAINT "messageTemplates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_history" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_jid" TEXT NOT NULL,
    "sender_jid" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(6) NOT NULL,
    "message_type" TEXT NOT NULL,
    "text_content" TEXT,
    "media_link" TEXT,
    "quoted_message_id" TEXT,
    "datajson" TEXT,

    CONSTRAINT "message_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reactions" (
    "messageId" TEXT NOT NULL,
    "participant" TEXT,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "userId" VARCHAR(50),
    "id" VARCHAR(50) NOT NULL,

    CONSTRAINT "id" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" VARCHAR(50) NOT NULL,
    "chatId" VARCHAR(50),
    "message" TEXT NOT NULL,
    "timeStamp" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "isDelivered" BOOLEAN DEFAULT false,
    "isRead" BOOLEAN DEFAULT false,
    "messageType" TEXT,
    "isFromMe" BOOLEAN,
    "contactId" VARCHAR(50),
    "isEdit" BOOLEAN,
    "pushname" TEXT,
    "mediaPath" TEXT,
    "note" TEXT,
    "isPinned" BOOLEAN,
    "userId" TEXT,
    "replyToMessageId" VARCHAR(50),

    CONSTRAINT "chatmessages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "tagId" BIGSERIAL NOT NULL,
    "tagName" TEXT,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("tagId")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "webhook" TEXT NOT NULL DEFAULT '',
    "jid" TEXT NOT NULL DEFAULT '',
    "qrcode" TEXT NOT NULL DEFAULT '',
    "connected" INTEGER,
    "expiration" INTEGER,
    "events" TEXT NOT NULL DEFAULT '',
    "proxy_url" TEXT DEFAULT '',
    "s3_enabled" BOOLEAN DEFAULT false,
    "s3_endpoint" TEXT DEFAULT '',
    "s3_region" TEXT DEFAULT '',
    "s3_bucket" TEXT DEFAULT '',
    "s3_access_key" TEXT DEFAULT '',
    "s3_secret_key" TEXT DEFAULT '',
    "s3_path_style" BOOLEAN DEFAULT true,
    "s3_public_url" TEXT DEFAULT '',
    "media_delivery" TEXT DEFAULT 'base64',
    "s3_retention_days" INTEGER DEFAULT 30,
    "history" INTEGER DEFAULT 0,
    "hmac_key" BYTEA,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsmeow_app_state_mutation_macs" (
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" BIGINT NOT NULL,
    "index_mac" BYTEA NOT NULL,
    "value_mac" BYTEA NOT NULL,

    CONSTRAINT "whatsmeow_app_state_mutation_macs_pkey" PRIMARY KEY ("jid","name","version","index_mac")
);

-- CreateTable
CREATE TABLE "whatsmeow_app_state_sync_keys" (
    "jid" TEXT NOT NULL,
    "key_id" BYTEA NOT NULL,
    "key_data" BYTEA NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "fingerprint" BYTEA NOT NULL,

    CONSTRAINT "whatsmeow_app_state_sync_keys_pkey" PRIMARY KEY ("jid","key_id")
);

-- CreateTable
CREATE TABLE "whatsmeow_app_state_version" (
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" BIGINT NOT NULL,
    "hash" BYTEA NOT NULL,

    CONSTRAINT "whatsmeow_app_state_version_pkey" PRIMARY KEY ("jid","name")
);

-- CreateTable
CREATE TABLE "whatsmeow_chat_settings" (
    "our_jid" TEXT NOT NULL,
    "chat_jid" TEXT NOT NULL,
    "muted_until" BIGINT NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "whatsmeow_chat_settings_pkey" PRIMARY KEY ("our_jid","chat_jid")
);

-- CreateTable
CREATE TABLE "whatsmeow_contacts" (
    "our_jid" TEXT NOT NULL,
    "their_jid" TEXT NOT NULL,
    "first_name" TEXT,
    "full_name" TEXT,
    "push_name" TEXT,
    "business_name" TEXT,
    "redacted_phone" TEXT,

    CONSTRAINT "whatsmeow_contacts_pkey" PRIMARY KEY ("our_jid","their_jid")
);

-- CreateTable
CREATE TABLE "whatsmeow_device" (
    "jid" TEXT NOT NULL,
    "lid" TEXT,
    "facebook_uuid" UUID,
    "registration_id" BIGINT NOT NULL,
    "noise_key" BYTEA NOT NULL,
    "identity_key" BYTEA NOT NULL,
    "signed_pre_key" BYTEA NOT NULL,
    "signed_pre_key_id" INTEGER NOT NULL,
    "signed_pre_key_sig" BYTEA NOT NULL,
    "adv_key" BYTEA NOT NULL,
    "adv_details" BYTEA NOT NULL,
    "adv_account_sig" BYTEA NOT NULL,
    "adv_account_sig_key" BYTEA NOT NULL,
    "adv_device_sig" BYTEA NOT NULL,
    "platform" TEXT NOT NULL DEFAULT '',
    "business_name" TEXT NOT NULL DEFAULT '',
    "push_name" TEXT NOT NULL DEFAULT '',
    "lid_migration_ts" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "whatsmeow_device_pkey" PRIMARY KEY ("jid")
);

-- CreateTable
CREATE TABLE "whatsmeow_event_buffer" (
    "our_jid" TEXT NOT NULL,
    "ciphertext_hash" BYTEA NOT NULL,
    "plaintext" BYTEA,
    "server_timestamp" BIGINT NOT NULL,
    "insert_timestamp" BIGINT NOT NULL,

    CONSTRAINT "whatsmeow_event_buffer_pkey" PRIMARY KEY ("our_jid","ciphertext_hash")
);

-- CreateTable
CREATE TABLE "whatsmeow_identity_keys" (
    "our_jid" TEXT NOT NULL,
    "their_id" TEXT NOT NULL,
    "identity" BYTEA NOT NULL,

    CONSTRAINT "whatsmeow_identity_keys_pkey" PRIMARY KEY ("our_jid","their_id")
);

-- CreateTable
CREATE TABLE "whatsmeow_lid_map" (
    "lid" TEXT NOT NULL,
    "pn" TEXT NOT NULL,

    CONSTRAINT "whatsmeow_lid_map_pkey" PRIMARY KEY ("lid")
);

-- CreateTable
CREATE TABLE "whatsmeow_message_secrets" (
    "our_jid" TEXT NOT NULL,
    "chat_jid" TEXT NOT NULL,
    "sender_jid" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "key" BYTEA NOT NULL,

    CONSTRAINT "whatsmeow_message_secrets_pkey" PRIMARY KEY ("our_jid","chat_jid","sender_jid","message_id")
);

-- CreateTable
CREATE TABLE "whatsmeow_pre_keys" (
    "jid" TEXT NOT NULL,
    "key_id" INTEGER NOT NULL,
    "key" BYTEA NOT NULL,
    "uploaded" BOOLEAN NOT NULL,

    CONSTRAINT "whatsmeow_pre_keys_pkey" PRIMARY KEY ("jid","key_id")
);

-- CreateTable
CREATE TABLE "whatsmeow_privacy_tokens" (
    "our_jid" TEXT NOT NULL,
    "their_jid" TEXT NOT NULL,
    "token" BYTEA NOT NULL,
    "timestamp" BIGINT NOT NULL,

    CONSTRAINT "whatsmeow_privacy_tokens_pkey" PRIMARY KEY ("our_jid","their_jid")
);

-- CreateTable
CREATE TABLE "whatsmeow_sender_keys" (
    "our_jid" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_key" BYTEA NOT NULL,

    CONSTRAINT "whatsmeow_sender_keys_pkey" PRIMARY KEY ("our_jid","chat_id","sender_id")
);

-- CreateTable
CREATE TABLE "whatsmeow_sessions" (
    "our_jid" TEXT NOT NULL,
    "their_id" TEXT NOT NULL,
    "session" BYTEA,

    CONSTRAINT "whatsmeow_sessions_pkey" PRIMARY KEY ("our_jid","their_id")
);

-- CreateTable
CREATE TABLE "whatsmeow_version" (
    "version" INTEGER,
    "compat" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_username_key" ON "app_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "chat_assignment_unique" ON "chatAssignmentDetail"("chatId", "assignedTo");

-- CreateIndex
CREATE INDEX "idx_chat_status_details_changed_at" ON "chat_status_details"("changed_at");

-- CreateIndex
CREATE INDEX "idx_chat_status_details_chat_id" ON "chat_status_details"("chat_id");

-- CreateIndex
CREATE INDEX "idx_chat_status_details_status" ON "chat_status_details"("status");

-- CreateIndex
CREATE INDEX "idx_message_history_user_chat_timestamp" ON "message_history"("user_id", "chat_jid", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "message_history_user_id_message_id_key" ON "message_history"("user_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "unique_reaction_per_user_message" ON "message_reactions"("messageId", "participant");

-- CreateIndex
CREATE UNIQUE INDEX "whatsmeow_lid_map_pn_key" ON "whatsmeow_lid_map"("pn");

-- AddForeignKey
ALTER TABLE "chat_status_details" ADD CONSTRAINT "chat_status_details_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chatparticipants" ADD CONSTRAINT "chatparticipants_chatid_fkey" FOREIGN KEY ("chatid") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chatparticipants" ADD CONSTRAINT "chatparticipants_contactid_fkey" FOREIGN KEY ("contactid") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_reactions" ADD CONSTRAINT "fk_message_reactions_message" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "chatmessages_chatid_fkey" FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "whatsmeow_app_state_mutation_macs" ADD CONSTRAINT "whatsmeow_app_state_mutation_macs_jid_name_fkey" FOREIGN KEY ("jid", "name") REFERENCES "whatsmeow_app_state_version"("jid", "name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_app_state_sync_keys" ADD CONSTRAINT "whatsmeow_app_state_sync_keys_jid_fkey" FOREIGN KEY ("jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_app_state_version" ADD CONSTRAINT "whatsmeow_app_state_version_jid_fkey" FOREIGN KEY ("jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_chat_settings" ADD CONSTRAINT "whatsmeow_chat_settings_our_jid_fkey" FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_contacts" ADD CONSTRAINT "whatsmeow_contacts_our_jid_fkey" FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_event_buffer" ADD CONSTRAINT "whatsmeow_event_buffer_our_jid_fkey" FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_identity_keys" ADD CONSTRAINT "whatsmeow_identity_keys_our_jid_fkey" FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_message_secrets" ADD CONSTRAINT "whatsmeow_message_secrets_our_jid_fkey" FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_pre_keys" ADD CONSTRAINT "whatsmeow_pre_keys_jid_fkey" FOREIGN KEY ("jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_sender_keys" ADD CONSTRAINT "whatsmeow_sender_keys_our_jid_fkey" FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsmeow_sessions" ADD CONSTRAINT "whatsmeow_sessions_our_jid_fkey" FOREIGN KEY ("our_jid") REFERENCES "whatsmeow_device"("jid") ON DELETE CASCADE ON UPDATE CASCADE;
