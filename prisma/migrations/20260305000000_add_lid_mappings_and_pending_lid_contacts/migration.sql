-- CreateTable
CREATE TABLE IF NOT EXISTS "lid_mappings" (
    "lid" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lid_mappings_pkey" PRIMARY KEY ("lid")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lid_mappings_phone" ON "lid_mappings"("phone");

-- CreateTable
CREATE TABLE IF NOT EXISTS "pending_lid_contacts" (
    "lid" VARCHAR(100) NOT NULL,
    "chat_id" VARCHAR(50),
    "full_name" TEXT,
    "first_name" TEXT,
    "push_name" TEXT,
    "business_name" TEXT,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_lid_contacts_pkey" PRIMARY KEY ("lid")
);
