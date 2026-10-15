-- Optional product page / PDP / datasheet URL (not an image). Null = none.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_url" TEXT;
