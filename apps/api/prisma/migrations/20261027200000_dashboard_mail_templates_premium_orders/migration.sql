-- AlterTable
ALTER TABLE "buyer_profiles" ADD COLUMN     "quizStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "premium_leads" ADD COLUMN     "orderId" UUID;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "reviewInviteAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reviewInvitesOffAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "mail_templates" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_templates_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "premium_leads_orderId_key" ON "premium_leads"("orderId");

-- CreateIndex
CREATE INDEX "shipments_status_deliveredAt_idx" ON "shipments"("status", "deliveredAt");

-- AddForeignKey
ALTER TABLE "premium_leads" ADD CONSTRAINT "premium_leads_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Начало анкеты для уже заполнявших профиль: точного времени нет — берём завершение или последнюю правку
UPDATE "buyer_profiles" SET "quizStartedAt" = COALESCE("quizCompletedAt", "updatedAt") WHERE "completenessPct" > 0;
