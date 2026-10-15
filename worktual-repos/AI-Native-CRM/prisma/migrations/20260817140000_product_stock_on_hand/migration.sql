-- Optional catalog stock for B2C / retail B2B2C. Null = not tracked.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_on_hand" INTEGER;
