import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";
import { assertPostgresWriteAllowed, isPostgresReadOnly } from "../lib/postgresReadOnly.js";
function createPrismaClient() {
    const client = new PrismaClient();
    if (!isPostgresReadOnly()) {
        return client;
    }
    return client.$extends({
        query: {
            $allModels: {
                async $allOperations({ operation, args, query }) {
                    assertPostgresWriteAllowed(operation);
                    return query(args);
                },
            },
        },
    });
}
export const prismaPlugin = fp(async function prismaPlugin(app) {
    const prisma = createPrismaClient();
    // Fastify decorate expects PrismaClient; $extends client is cast at creation time.
    app.decorate("prisma", prisma);
    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });
});
