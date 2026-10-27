-- Кабинет поставщика: расписание YML-фида, ключи партнёрского API, дневные агрегаты просмотров и корзины

-- CreateTable
CREATE TABLE "supplier_feed_schedules" (
    "supplierId" UUID NOT NULL,
    "everyHours" INTEGER NOT NULL DEFAULT 6,
    "pausedAt" TIMESTAMP(3),
    "pauseReason" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_feed_schedules_pkey" PRIMARY KEY ("supplierId")
);

-- CreateTable
CREATE TABLE "partner_api_keys" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "partner_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_daily_stats" (
    "productId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "cartAdds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_daily_stats_pkey" PRIMARY KEY ("productId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_api_keys_hash_key" ON "partner_api_keys"("hash");

-- CreateIndex
CREATE INDEX "partner_api_keys_supplierId_idx" ON "partner_api_keys"("supplierId");

-- CreateIndex
CREATE INDEX "product_daily_stats_day_idx" ON "product_daily_stats"("day");

-- AddForeignKey
ALTER TABLE "supplier_feed_schedules" ADD CONSTRAINT "supplier_feed_schedules_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_api_keys" ADD CONSTRAINT "partner_api_keys_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_daily_stats" ADD CONSTRAINT "product_daily_stats_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
