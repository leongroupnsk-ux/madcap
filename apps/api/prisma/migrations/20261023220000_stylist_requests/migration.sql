-- CreateEnum
CREATE TYPE "StylistRequestStatus" AS ENUM ('open', 'answered', 'cancelled');

-- AlterEnum
ALTER TYPE "StaffRole" ADD VALUE 'stylist';

-- CreateTable
CREATE TABLE "stylist_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "sharePhotos" BOOLEAN NOT NULL,
    "status" "StylistRequestStatus" NOT NULL DEFAULT 'open',
    "answer" TEXT,
    "stylistId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "stylist_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stylist_requests_status_createdAt_idx" ON "stylist_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "stylist_requests_userId_createdAt_idx" ON "stylist_requests"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "stylist_requests" ADD CONSTRAINT "stylist_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Один открытый запрос на покупателя (Prisma частичные индексы не описывает — не удалять при migrate diff)
CREATE UNIQUE INDEX "stylist_requests_one_open_per_user" ON "stylist_requests"("userId") WHERE "status" = 'open';
