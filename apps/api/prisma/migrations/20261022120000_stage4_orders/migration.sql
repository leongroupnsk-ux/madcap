-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('pvz', 'courier');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'canceled');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('awaiting_payment', 'new', 'confirmed', 'packed', 'handed_over', 'in_transit', 'ready_for_pickup', 'delivered', 'cancelled', 'rejected');

-- CreateEnum
CREATE TYPE "PayoutKind" AS ENUM ('sale', 'refund');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'succeeded', 'canceled');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('requested', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "cdekShipmentPoint" TEXT,
ADD COLUMN     "payoutAccount" TEXT,
ADD COLUMN     "payoutBik" TEXT,
ADD COLUMN     "payoutInn" TEXT,
ADD COLUMN     "payoutLegalName" TEXT,
ADD COLUMN     "payoutRequestedAt" TIMESTAMP(3),
ADD COLUMN     "vatCode" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "cart_items" (
    "userId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "fromCapsule" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("userId","variantId")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "DeliveryType" NOT NULL,
    "cityCode" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "street" TEXT,
    "flat" TEXT,
    "intercom" TEXT,
    "entrance" TEXT,
    "floor" TEXT,
    "comment" TEXT,
    "pvzCode" TEXT,
    "pvzAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "paymentId" TEXT,
    "paymentMethod" TEXT,
    "confirmationUrl" TEXT,
    "goodsTotal" INTEGER NOT NULL,
    "deliveryTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "no" INTEGER NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'awaiting_payment',
    "deliveryType" "DeliveryType" NOT NULL,
    "tariffCode" INTEGER NOT NULL,
    "cityCode" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "pvzCode" TEXT,
    "addressJson" JSONB NOT NULL DEFAULT '{}',
    "deliveryPrice" INTEGER NOT NULL,
    "periodMin" INTEGER NOT NULL,
    "periodMax" INTEGER NOT NULL,
    "eta" TIMESTAMP(3),
    "goodsTotal" INTEGER NOT NULL,
    "commissionBp" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "cdekUuid" TEXT,
    "trackNo" TEXT,
    "rejectReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "variantId" UUID,
    "productSlug" TEXT,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "heightRange" TEXT,
    "color" TEXT NOT NULL,
    "imageKey" TEXT,
    "price" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "fromCapsule" BOOLEAN NOT NULL DEFAULT false,
    "weightG" INTEGER NOT NULL DEFAULT 400,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "kind" "PayoutKind" NOT NULL,
    "amountGoods" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "transferred" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "shipmentId" UUID,
    "amount" INTEGER NOT NULL,
    "goodsAmount" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "idempotenceKey" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "items" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'requested',
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_paymentId_key" ON "orders"("paymentId");

-- CreateIndex
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_expiresAt_idx" ON "orders"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_cdekUuid_key" ON "shipments"("cdekUuid");

-- CreateIndex
CREATE INDEX "shipments_supplierId_status_idx" ON "shipments"("supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_orderId_no_key" ON "shipments"("orderId", "no");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_at_idx" ON "shipment_events"("shipmentId", "at");

-- CreateIndex
CREATE INDEX "payouts_supplierId_createdAt_idx" ON "payouts"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_providerRefundId_key" ON "refunds"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotenceKey_key" ON "refunds"("idempotenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_objectId_event_key" ON "webhook_events"("source", "objectId", "event");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Номера заказов для покупателя
CREATE SEQUENCE "order_number_seq" START 100001;
