-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('new', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('file', 'yml');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('queued', 'checking', 'checked', 'applying', 'applied', 'failed');

-- AlterTable
ALTER TABLE "product_media" ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "durationS" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "sizeBytes" INTEGER,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "supplier_applications" (
    "id" UUID NOT NULL,
    "company" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "assortment" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'new',
    "rejectReason" TEXT,
    "supplierId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "supplier_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_revisions" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "product_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "source" "ImportSource" NOT NULL,
    "fileName" TEXT,
    "fileKey" TEXT,
    "feedUrl" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'queued',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "newProducts" INTEGER NOT NULL DEFAULT 0,
    "updates" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "payload" JSONB,
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "autoApply" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_applications_supplierId_key" ON "supplier_applications"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_applications_status_createdAt_idx" ON "supplier_applications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "product_revisions_status_createdAt_idx" ON "product_revisions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_supplierId_createdAt_idx" ON "import_jobs"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_entity_entityId_idx" ON "audit_log"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "products_supplierId_externalId_key" ON "products"("supplierId", "externalId");

-- AddForeignKey
ALTER TABLE "supplier_applications" ADD CONSTRAINT "supplier_applications_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

