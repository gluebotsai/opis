import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ProductDetailClient } from "@/components/products/ProductDetailClient";
import { canEditProducts, normalizeRole } from "@/lib/rbac";
import { fetchProduct, updateProduct, deleteProduct, type ProductDetail } from "@/services/products";
import { useAppSelector } from "@/store";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { BackLink } from "@/components/ui/BackLink";

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const role = normalizeRole(user?.role);
  const canEdit = canEditProducts(role);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductDetail | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchProduct(id);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setProduct(null);
        } else {
          setProduct(result.product);
        }
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

  const reload = async () => {
    if (!id) return;
    const result = await fetchProduct(id);
    if (result.ok) setProduct(result.product);
  };

  if (id === "new") {
    return <Navigate to="/product/new" replace />;
  }

  if (loading) {
    return (
      <AgentModuleShell
        moduleId="product"
        title="Product"
        welcome="I'm your **product agent**. Ask about catalog details while the product loads on the right."
        surface="detail"
        entityId={id ?? null}
        workspace={
          <div className="px-6 py-10 text-sm text-text-caption">Loading…</div>
        }
      />
    );
  }

  if (!product) {
    return (
      <AgentModuleShell
        moduleId="product"
        title="Product"
        welcome="I'm your **product agent**. Ask about catalog details while you use the workspace on the right."
        surface="detail"
        entityId={id ?? null}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
            <BackLink to="/product" className="mt-3">
              Back to products
            </BackLink>
          </div>
        }
      />
    );
  }

  return (
    <AgentModuleShell
      moduleId="product"
      title={product.name}
      welcome={`I'm your **product agent** for **${product.name}**. Ask me about pricing or catalog details — the product record stays fully usable on the right.`}
      chips={[
        {
          id: "chip-help",
          label: "What can you help with?",
          prompt: "What can you help me do with this product?",
        },
      ]}
      surface="detail"
      entityId={id ?? null}
      workspace={
        <ProductDetailClient
          product={product}
          canEdit={canEdit}
          onRefresh={reload}
        />
      }
      onToolConfirm={async (tool) => {
        if (tool.name === "propose_update_product") {
          const productId = String(tool.args.productId || id || "");
          if (!productId) return false;
          const detail = await fetchProduct(productId);
          if (!detail.ok) return false;
          const { productUpdateBodyFromToolArgs } = await import(
            "@/lib/coworker/product-update-from-tool"
          );
          const body = productUpdateBodyFromToolArgs(
            detail.product,
            tool.args,
            user?.businessType,
          );
          if (!body) return false;
          const result = await updateProduct(productId, body);
          if (!result.ok) return false;
          await reload();
          return true;
        }
        if (tool.name === "propose_delete_product") {
          const productId = String(tool.args.productId || id || "");
          if (!productId) return false;
          const result = await deleteProduct(productId);
          if (!result.ok) return false;
          navigate("/product");
          return true;
        }
        return false;
      }}
      onAfterTool={() => void reload()}
    />
  );
}
