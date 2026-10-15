import type { FastifyPluginAsync } from "fastify";
import {
  createProductCommand,
  deleteProductCommand,
  getProductCommand,
  importProductsCommand,
  listCategoriesCommand,
  listProductsCommand,
  listProductsSelectCommand,
  updateProductCommand,
  updateProductStatusCommand,
} from "@/service/products/product-commands";
import {
  createPriceBookCommand,
  deletePriceBookCommand,
  deletePriceBookEntryCommand,
  listPriceBookEntriesCommand,
  listPriceBooksCommand,
  resolveListPriceCommand,
  updatePriceBookCommand,
  upsertPriceBookEntryCommand,
} from "@/service/products/price-book-commands";
import { requireSessionOrApiKey, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";

export const productsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      search?: string;
      status?: string;
      category?: string;
    };
  }>("/", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number(request.query.pageSize) || 24),
      );
      const result = await listProductsCommand({
        page,
        pageSize,
        search: request.query.search,
        status: request.query.status,
        category: request.query.category,
      });
      return sendSuccess(reply, result);
    });
  });

  app.get("/categories", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const categories = await listCategoriesCommand();
      return sendSuccess(reply, { categories });
    });
  });

  app.get<{ Querystring: { limit?: string } }>("/select", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const limit = request.query.limit
        ? Number(request.query.limit)
        : undefined;
      const items = await listProductsSelectCommand(limit);
      return sendSuccess(reply, { items });
    });
  });

  app.get("/price-books", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listPriceBooksCommand();
      return sendSuccess(reply, result);
    });
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/price-books",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await createPriceBookCommand(request.body ?? {});
        return sendResult(reply, result);
      });
    },
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/price-books/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updatePriceBookCommand(
          request.params.id,
          request.body ?? {},
        );
        return sendResult(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/price-books/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deletePriceBookCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.get<{
    Querystring: { priceBookId: string; productId?: string };
  }>("/price-book-entries", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      if (!request.query.priceBookId) {
        return sendError(reply, "priceBookId is required.", 400);
      }
      const result = await listPriceBookEntriesCommand({
        priceBookId: request.query.priceBookId,
        productId: request.query.productId,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/price-book-entries",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await upsertPriceBookEntryCommand(request.body ?? {});
        return sendResult(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/price-book-entries/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deletePriceBookEntryCommand(request.params.id);
        return sendResult(reply, result);
      });
    },
  );

  app.get<{
    Querystring: {
      productId?: string;
      offerId?: string;
      addonId?: string;
      priceBookId?: string;
    };
  }>("/resolve-price", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await resolveListPriceCommand(request.query);
      return sendResult(reply, result);
    });
  });

  app.post<{ Body: { csvText?: string; dryRun?: boolean } }>(
    "/import",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const csvText = request.body?.csvText ?? "";
        if (!csvText.trim()) {
          return sendError(reply, "csvText is required.", 400);
        }
        const result = await importProductsCommand({
          csvText,
          dryRun: request.body?.dryRun,
        });
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Body: Record<string, unknown> }>("/", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await createProductCommand(request.body ?? {});
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getProductCommand(request.params.id);
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateProductCommand(
          request.params.id,
          request.body ?? {},
        );
        return sendResult(reply, result);
      });
    },
  );

  /** Status-only (Activate) — does not rewrite addons/offers. */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/:id/status",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "products");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateProductStatusCommand(
          request.params.id,
          request.body ?? {},
        );
        return sendResult(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "products");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await deleteProductCommand(request.params.id);
      return sendResult(reply, result);
    });
  });
};
