-- AlterTable
ALTER TABLE "product_media" ADD COLUMN     "colorId" UUID;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

