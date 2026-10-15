import { prisma } from "../src/dao/db/prisma.js";

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'crm' AND table_name = 'appointments') AS exists",
  );
  console.log("crm.appointments exists:", rows[0]?.exists);

  if (rows[0]?.exists) {
    const count = await prisma.appointment.count();
    console.log("appointment row count:", count);
  }
}

main()
  .catch((err) => {
    console.error("DB check failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
