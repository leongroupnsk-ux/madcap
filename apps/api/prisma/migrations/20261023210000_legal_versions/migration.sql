-- CreateTable
CREATE TABLE "legal_versions" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "publishedBy" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_versions_slug_version_key" ON "legal_versions"("slug", "version");

