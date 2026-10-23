-- CreateEnum
CREATE TYPE "Settlement" AS ENUM ('split', 'registry');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "settlement" "Settlement" NOT NULL DEFAULT 'split';

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registryId" UUID;

-- CreateTable
CREATE TABLE "payout_registries" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "total" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidBy" UUID,

    CONSTRAINT "payout_registries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_registries_number_key" ON "payout_registries"("number");

-- CreateIndex
CREATE INDEX "payouts_manual_registryId_idx" ON "payouts"("manual", "registryId");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "payout_registries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

