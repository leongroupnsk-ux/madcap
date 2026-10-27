-- CreateTable
CREATE TABLE "search_empty_queries" (
    "query" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_empty_queries_pkey" PRIMARY KEY ("query")
);

-- CreateIndex
CREATE INDEX "search_empty_queries_lastAt_idx" ON "search_empty_queries"("lastAt");

