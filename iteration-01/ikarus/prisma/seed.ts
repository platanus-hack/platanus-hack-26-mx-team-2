import { PrismaClient } from "@prisma/client";

/**
 * Demo seed (§11). Creates a workspace user with the two mock upstream connections
 * (mailbox + mailer) and their default-secure policies. The connection `label` IS
 * the runtime mcpId the gateway uses, so policies bind correctly. Set
 * IKARUS_WORKSPACE_USER to this user's id so the MCP endpoint loads this config.
 *
 * Run: pnpm --filter @ikarus/server db:seed
 */
const prisma = new PrismaClient();

const DEMO_USER_ID = process.env.IKARUS_WORKSPACE_USER ?? "demo-user";

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: { id: DEMO_USER_ID, email: "demo@ikarus.local" },
  });

  const mailbox = await prisma.mcpConnection.upsert({
    where: { id: "seed-mailbox" },
    update: {},
    create: {
      id: "seed-mailbox",
      userId: user.id,
      label: "mailbox",
      transport: "HTTP",
      endpoint: "in-memory://mailbox",
      status: "connected",
    },
  });

  const mailer = await prisma.mcpConnection.upsert({
    where: { id: "seed-mailer" },
    update: {},
    create: {
      id: "seed-mailer",
      userId: user.id,
      label: "mailer",
      transport: "HTTP",
      endpoint: "in-memory://mailer",
      status: "connected",
    },
  });

  // Default-secure policies: reads open, the sink requires every arg trusted.
  await prisma.policy.upsert({
    where: { connectionId_toolName: { connectionId: mailbox.id, toolName: "list_recent" } },
    update: {},
    create: {
      userId: user.id,
      connectionId: mailbox.id,
      toolName: "list_recent",
      effect: "READ",
      sensitiveArgs: [],
      requireTrusted: false,
    },
  });
  await prisma.policy.upsert({
    where: { connectionId_toolName: { connectionId: mailer.id, toolName: "send_email" } },
    update: {},
    create: {
      userId: user.id,
      connectionId: mailer.id,
      toolName: "send_email",
      effect: "SINK",
      sensitiveArgs: ["to", "subject", "body"],
      requireTrusted: true,
    },
  });

  console.log(`Seeded workspace user "${user.id}" with mailbox + mailer and default-secure policies.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
