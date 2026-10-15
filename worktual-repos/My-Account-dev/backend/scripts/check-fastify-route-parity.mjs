import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

const backendRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

function extractRoutes(relativePath, prefix = "") {
  const filePath = path.join(backendRoot, relativePath);
  if (!fs.existsSync(filePath)) return [];

  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const routes = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      ["get", "post", "put", "patch", "delete"].includes(
        node.expression.name.text,
      )
    ) {
      const route = node.arguments[0];
      if (
        route &&
        (ts.isStringLiteral(route) || ts.isNoSubstitutionTemplateLiteral(route))
      ) {
        const suffix = prefix && route.text === "/" ? "" : route.text;
        routes.push(
          `${node.expression.name.text.toUpperCase()} ${prefix}${suffix}`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

const nativePlugins = [
  ["src/modules/auth/staff-auth-routes.ts", "/api/auth"],
  ["src/modules/users/admin-routes.ts", "/api/admin/users"],
  ["src/modules/health/legacy-health.ts", "/api"],
  ["src/modules/platform/routes.ts", "/api"],
  ["src/modules/leads/native-routes.ts", "/api/leads"],
  ["src/modules/quotations/native-routes.ts", "/api"],
  ["src/modules/sales-oversight/native-routes.ts", "/api/sales-oversight"],
  ["src/modules/customer-portal/native-routes.ts", ""],
  ["src/modules/partners/native-routes.ts", ""],
  ["src/modules/resellers/native-routes.ts", ""],
  ["src/modules/commissions/native-routes.ts", ""],
  ["src/modules/number-management/native-routes.ts", ""],
  ["src/modules/branch-requests/admin-native-routes.ts", ""],
  ["src/modules/mail/native-routes.ts", ""],
  ["src/modules/events/native-routes.ts", ""],
  ["src/modules/payments/native-webhook-routes.ts", ""],
];

const nativeRoutes = new Set(
  nativePlugins.flatMap(([file, prefix]) => extractRoutes(file, prefix)),
);
if (
  fs.existsSync(
    path.join(
      backendRoot,
      "src/modules/payments/native-webhook-routes.ts",
    ),
  )
) {
  nativeRoutes.add("POST /api/payments/webhook/stripe");
  nativeRoutes.add("POST /api/payments/webhook/razorpay");
}
const legacyEntryExists = fs.existsSync(path.join(backendRoot, "index.js"));
const legacyRoutes = legacyEntryExists
  ? extractRoutes("index.js").filter((route) => !route.endsWith(" *"))
  : [];
const expectedNativeRouteCount = 182;
const missingRoutes = legacyEntryExists
  ? legacyRoutes.filter((route) => !nativeRoutes.has(route))
  : [];
const routeCountMatches =
  nativeRoutes.size ===
  (legacyEntryExists ? legacyRoutes.length : expectedNativeRouteCount);

console.log(
  JSON.stringify(
    {
      legacyRouteCount: legacyEntryExists ? legacyRoutes.length : null,
      expectedNativeRouteCount,
      nativeRouteCount: nativeRoutes.size,
      missingRouteCount: missingRoutes.length,
      missingRoutes,
      routeCountMatches,
    },
    null,
    2,
  ),
);

if (missingRoutes.length > 0 || !routeCountMatches) {
  process.exitCode = 1;
}
