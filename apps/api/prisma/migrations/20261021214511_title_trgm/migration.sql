DROP INDEX IF EXISTS "products_title_trgm_idx";
-- CreateIndex
CREATE INDEX "products_title_trgm_idx" ON "products" USING GIN ("title" gin_trgm_ops);

