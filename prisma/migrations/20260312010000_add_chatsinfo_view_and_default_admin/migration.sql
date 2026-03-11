CREATE OR REPLACE VIEW public.chatsinfo AS
SELECT chats.id,
       chats."lastMessage",
       chats."lastMessageTime",
       chats."unReadCount",
       chats."isOnline",
       chats."contactId" AS contactid,
       chats."isTyping",
       COALESCE(groups.name, lm.full_name::text, lm.first_name::text, lm.business_name::text, lm.push_name::text, chats.pushname) AS name,
       COALESCE(lm.phone, (groups.id || '@g.us'::text)::character varying)::character varying(50) AS phone,
       lm.is_my_contact,
       lm.is_business,
       tags.tagsname,
       chats.isarchived,
       chats."assignedTo",
       chats.ismuted,
       chats.status,
       chats.avatar,
       last_msg.status AS "lastMessageStatus"
FROM chats
LEFT JOIN lid_mappings lm ON lm.lid::text = chats.id::text
LEFT JOIN groups ON groups.id = chats.id::text
LEFT JOIN (
    SELECT "chatTags"."chatId",
           string_agg((tags_1."tagName" || '_-_'::text) || tags_1."tagId"::text, '-_-'::text) AS tagsname
    FROM tags tags_1
    JOIN "chatTags" ON "chatTags"."tagId" = tags_1."tagId"
    GROUP BY "chatTags"."chatId"
) tags ON tags."chatId"::text = chats.id::text
LEFT JOIN LATERAL (
    SELECT messages.status
    FROM messages
    WHERE messages."chatId"::text = chats.id::text
    ORDER BY messages."timeStamp" DESC
    LIMIT 1
) last_msg ON true;

INSERT INTO public.app_users (
    id,
    username,
    email,
    password_hash,
    first_name,
    last_name,
    role,
    is_active
)
SELECT
    '00000000-0000-0000-0000-000000000001',
    'admin',
    'admin@example.com',
    '$2b$10$6mvDL9v8fI3rM8E3QA52tegtYO4h87hVG8z0XL3IPZibsnECPXE1C',
    'Admin',
    'User',
    'admin',
    true
WHERE NOT EXISTS (
    SELECT 1 FROM public.app_users WHERE username = 'admin'
);
