-- CreateEnum
CREATE TYPE "PremiumMessageDirection" AS ENUM ('outgoing', 'incoming');

-- CreateEnum
CREATE TYPE "PremiumMessageChannel" AS ENUM ('telegram', 'whatsapp', 'note');

-- CreateEnum
CREATE TYPE "PremiumMessageStatus" AS ENUM ('sent', 'failed', 'received', 'offline');

-- AlterEnum
ALTER TYPE "PremiumContact" ADD VALUE 'telegram';

-- AlterTable
ALTER TABLE "premium_leads" ADD COLUMN     "no" SERIAL NOT NULL,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "telegramCodeHash" TEXT,
ADD COLUMN     "telegramLinkedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "premium_lead_messages" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "direction" "PremiumMessageDirection" NOT NULL,
    "channel" "PremiumMessageChannel" NOT NULL,
    "text" TEXT NOT NULL,
    "staffId" UUID,
    "status" "PremiumMessageStatus" NOT NULL,
    "error" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premium_lead_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "premium_lead_messages_leadId_createdAt_idx" ON "premium_lead_messages"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "premium_lead_messages_direction_readAt_idx" ON "premium_lead_messages"("direction", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "premium_leads_no_key" ON "premium_leads"("no");

-- CreateIndex
CREATE UNIQUE INDEX "premium_leads_telegramCodeHash_key" ON "premium_leads"("telegramCodeHash");

-- CreateIndex
CREATE INDEX "premium_leads_telegramChatId_idx" ON "premium_leads"("telegramChatId");

-- AddForeignKey
ALTER TABLE "premium_lead_messages" ADD CONSTRAINT "premium_lead_messages_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "premium_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_lead_messages" ADD CONSTRAINT "premium_lead_messages_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

