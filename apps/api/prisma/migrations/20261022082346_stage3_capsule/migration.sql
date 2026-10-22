-- AlterTable
ALTER TABLE "buyer_profiles" ADD COLUMN     "quizCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "capsules" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "variantNo" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "explanations" JSONB NOT NULL DEFAULT '[]',
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capsules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsule_items" (
    "id" UUID NOT NULL,
    "capsuleId" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "productId" UUID,
    "variantId" UUID,
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "pinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "capsule_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "capsules_userId_variantNo_key" ON "capsules"("userId", "variantNo");

-- CreateIndex
CREATE UNIQUE INDEX "capsule_items_capsuleId_slot_key" ON "capsule_items"("capsuleId", "slot");

-- AddForeignKey
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_items" ADD CONSTRAINT "capsule_items_capsuleId_fkey" FOREIGN KEY ("capsuleId") REFERENCES "capsules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_items" ADD CONSTRAINT "capsule_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_items" ADD CONSTRAINT "capsule_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

