import { ProductDetailClientCrm } from "@/components/products/ProductDetailClientCrm";
import type { ProductDetail } from "@/services/products";

export function ProductDetailClient({
  product,
  canEdit,
  onRefresh,
}: {
  product: ProductDetail;
  canEdit: boolean;
  onRefresh?: () => void | Promise<void>;
}) {
  return (
    <ProductDetailClientCrm
      product={product}
      canEdit={canEdit}
      onRefresh={onRefresh}
    />
  );
}
