-- Optimize chatsInfo view for tab switching performance
-- Remove expensive LATERAL join for lastMessageStatus which isn't used
-- This eliminates N+1 query pattern from the LATERAL subquery

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
       NULL::character varying(20) AS "lastMessageStatus"
FROM chats
LEFT JOIN lid_mappings lm ON lm.lid::text = chats.id::text
LEFT JOIN groups ON groups.id = chats.id::text
LEFT JOIN (
    SELECT "chatTags"."chatId",
           string_agg((tags_1."tagName" || '_-_'::text) || tags_1."tagId"::text, '-_-'::text ORDER BY tags_1."tagId") AS tagsname
    FROM tags tags_1
    INNER JOIN "chatTags" ON "chatTags"."tagId" = tags_1."tagId"
    GROUP BY "chatTags"."chatId"
) tags ON tags."chatId"::text = chats.id::text;
