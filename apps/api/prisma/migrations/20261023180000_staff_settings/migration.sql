-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('owner', 'moderator', 'editor', 'support');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staffRole" "StaffRole";

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

