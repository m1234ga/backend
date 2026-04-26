-- CreateTable
CREATE TABLE "message_edits" (
    "id" BIGSERIAL NOT NULL,
    "messageId" VARCHAR(50) NOT NULL,
    "oldMessage" TEXT NOT NULL,
    "newMessage" TEXT NOT NULL,
    "editedAt" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_edits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_message_edits_message_id" ON "message_edits"("messageId");

-- CreateIndex
CREATE INDEX "idx_message_edits_edited_at" ON "message_edits"("editedAt");

-- AddForeignKey
ALTER TABLE "message_edits" ADD CONSTRAINT "fk_message_edits_message" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
