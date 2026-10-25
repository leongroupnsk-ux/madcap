-- CreateEnum
CREATE TYPE "PremiumLeadStatus" AS ENUM ('new', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "PremiumContact" AS ENUM ('phone', 'whatsapp');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "premium" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "premium_answers" (
    "userId" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_answers_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "premium_leads" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "contact" "PremiumContact" NOT NULL,
    "capsule" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "status" "PremiumLeadStatus" NOT NULL DEFAULT 'new',
    "managerComment" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "premium_leads_status_createdAt_idx" ON "premium_leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "premium_leads_userId_idx" ON "premium_leads"("userId");

-- AddForeignKey
ALTER TABLE "premium_answers" ADD CONSTRAINT "premium_answers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_leads" ADD CONSTRAINT "premium_leads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

