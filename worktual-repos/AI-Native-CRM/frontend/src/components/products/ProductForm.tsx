import { ProductFormCrm } from "@/components/products/ProductFormCrm";
import type { ProductDetail } from "@/services/products";

type Props = {
  product?: ProductDetail | null;
};

/** One form for B2B / B2C / B2B2C — motion hides offers/addons on B2C. */
export function ProductForm({ product }: Props) {
  return <ProductFormCrm product={product ?? undefined} />;
}
