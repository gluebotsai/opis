/// <reference types="node" />
import { PrismaClient, AgentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Telephony Platform database with 5 Contact Center Agents...');

  // 1. Create Default Tenant
  const tenant = await prisma.tenant.upsert({
    where: { apiKey: 'demo-tenant-api-key-12345' },
    update: {},
    create: {
      name: 'Default Enterprise Tenant',
      apiKey: 'demo-tenant-api-key-12345',
    },
  });
  console.log(`Created Tenant: ${tenant.name} (${tenant.id})`);

  // Hardcoded 5 Agents Credentials (Linphone SIP endpoints)
  const agentsData = [
    { name: 'WebRTC Agent 1', email: 'agent1001@example.com', extension: '1001', pass: 'password1001', status: AgentStatus.AVAILABLE },
    { name: 'Linphone Agent 2', email: 'agent1002@example.com', extension: '1002', pass: 'password1002', status: AgentStatus.AVAILABLE },
    { name: 'Linphone Agent 3', email: 'agent1003@example.com', extension: '1003', pass: 'password1003', status: AgentStatus.BUSY },
    { name: 'Linphone Agent 4', email: 'agent1004@example.com', extension: '1004', pass: 'password1004', status: AgentStatus.ON_BREAK },
    { name: 'Linphone Agent 5', email: 'agent1005@example.com', extension: '1005', pass: 'password1005', status: AgentStatus.OFFLINE },
  ];

  // Browser WebRTC softphone endpoints (separate from Linphone to avoid registration conflicts)
  const webrtcExtensions = [
    { extension: 'w1001', pass: 'webrtc_pass1001' },
    { extension: 'w1002', pass: 'webrtc_pass1002' },
    { extension: 'w1003', pass: 'webrtc_pass1003' },
    { extension: 'w1004', pass: 'webrtc_pass1004' },
    { extension: 'w1005', pass: 'webrtc_pass1005' },
  ];

  const createdAgents = [];

  for (const ag of agentsData) {
    const existing = await prisma.agent.findFirst({ where: { email: ag.email } });
    if (!existing) {
      const agent = await prisma.agent.create({
        data: {
          tenantId: tenant.id,
          name: ag.name,
          email: ag.email,
          status: ag.status,
          sipExtension: {
            create: {
              tenantId: tenant.id,
              extension: ag.extension,
              password: ag.pass,
            },
          },
        },
      });
      createdAgents.push(agent);
      console.log(`Created Agent: ${agent.name} (Ext ${ag.extension})`);
    } else {
      if (existing.name !== ag.name) {
        await prisma.agent.update({ where: { id: existing.id }, data: { name: ag.name } });
      }
      createdAgents.push(existing);
    }
  }

  for (const we of webrtcExtensions) {
    const existingExt = await prisma.sipExtension.findFirst({
      where: { tenantId: tenant.id, extension: we.extension },
    });
    if (!existingExt) {
      await prisma.sipExtension.create({
        data: {
          tenantId: tenant.id,
          extension: we.extension,
          password: we.pass,
        },
      });
      console.log(`Created WebRTC SIP extension: ${we.extension}`);
    }
  }

  // 2. Create Support Queue (1000)
  const existingQueue = await prisma.queue.findFirst({ where: { tenantId: tenant.id, name: 'Customer Support Queue' } });
  if (!existingQueue) {
    const queue = await prisma.queue.create({
      data: {
        tenantId: tenant.id,
        name: 'Customer Support Queue',
        strategy: 'ringall',
        timeout: 30,
        members: {
          create: createdAgents.map((ag, idx) => ({
            agentId: ag.id,
            penalty: idx,
          })),
        },
      },
    });
    console.log(`Created Queue: ${queue.name} with ${createdAgents.length} members.`);
  }

  // 3. Provision DID Numbers
  const numbersData = [
    { number: '+914440004407', provider: 'ASTERISK_TRUNK', assignedTo: 'AI_CONTACT_CENTER', routeTo: 'AI Contact Center Engine' },
    { number: '+18005550100', provider: 'AIRTEL', assignedTo: '1001', routeTo: 'Customer Support Queue' },
    { number: '+18005550200', provider: 'AIRTEL', assignedTo: '1002', routeTo: 'Customer Support Queue' },
  ];

  for (const num of numbersData) {
    await prisma.phoneNumber.upsert({
      where: { number: num.number },
      update: {},
      create: {
        tenantId: tenant.id,
        number: num.number,
        provider: num.provider,
        assignedTo: num.assignedTo,
        routeTo: num.routeTo,
      },
    });
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
