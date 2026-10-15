import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ProductForm } from "@/components/products/ProductForm";
import { BackLink } from "@/components/ui/BackLink";
import { fetchProduct, type ProductDetail } from "@/services/products";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { COWORKER_WORKSPACE_SCROLL } from "@/components/coworker/coworker-layout";

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await fetchProduct(id);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setProduct(result.product);
      } catch {
        if (!cancelled) setError("Failed to load product.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="px-6 py-10 text-sm text-text-caption">Loading…</div>
    );
  }

  if (isEdit && !product) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
        <BackLink to="/product" className="mt-3">
          Back to products
        </BackLink>
      </div>
    );
  }

  const formContent = (
    <div className={`mx-auto w-full max-w-3xl ${COWORKER_WORKSPACE_SCROLL}`}>
      <div className="px-4 pt-6 sm:px-6">
        <BackLink to="/product">Products</BackLink>
      </div>
      <ProductForm product={product ?? undefined} />
    </div>
  );

  if (!isEdit) return formContent;

  return (
    <AgentModuleShell
      moduleId="product"
      title={`Edit ${product?.name ?? "product"}`}
      welcome={`I'm your **product agent** for **${product?.name ?? "this product"}**. Ask me about pricing or catalog details while you edit the form on the right.`}
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do while editing this product?",
        },
      ]}
      surface="detail"
      entityId={id ?? null}
      workspace={formContent}
    />
  );
}
