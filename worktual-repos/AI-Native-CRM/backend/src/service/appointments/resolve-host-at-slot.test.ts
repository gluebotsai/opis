import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/dao/contacts/contact-service", () => ({
  getContact: vi.fn(),
}));

vi.mock("@/dao/sales/territory-assignment", () => ({
  listAssignmentCandidates: vi.fn(),
  resolveRegionalSalesOwner: vi.fn(),
  isSalesRepRoleName: (role: string | null | undefined) =>
    ["sales_rep", "sales rep", "sales", "rep"].includes(
      (role ?? "").trim().toLowerCase(),
    ),
}));

vi.mock("@/service/auth/require-role", () => ({
  getCurrentBusinessType: vi.fn(async () => "b2b"),
}));

vi.mock("@/service/ai/demo-booking", () => ({
  isSlotFree: vi.fn(),
  mailboxHasGoogleCalendar: vi.fn(),
  findFreeSlotsOnDay: vi.fn(),
}));

import { getContact } from "@/dao/contacts/contact-service";
import {
  listAssignmentCandidates,
  resolveRegionalSalesOwner,
} from "@/dao/sales/territory-assignment";
import {
  findFreeSlotsOnDay,
  isSlotFree,
  mailboxHasGoogleCalendar,
} from "@/service/ai/demo-booking";
import {
  clearAppointmentHostRankCache,
  findAvailableSlotsForDay,
  resolveHostAtSlot,
} from "@/service/appointments/resolve-host-at-slot";

const getContactMock = vi.mocked(getContact);
const listCandidatesMock = vi.mocked(listAssignmentCandidates);
const resolveOwnerMock = vi.mocked(resolveRegionalSalesOwner);
const isSlotFreeMock = vi.mocked(isSlotFree);
const mailboxHasCalMock = vi.mocked(mailboxHasGoogleCalendar);
const findFreeSlotsOnDayMock = vi.mocked(findFreeSlotsOnDay);

describe("resolveHostAtSlot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAppointmentHostRankCache();
    resolveOwnerMock.mockResolvedValue({
      status: "assigned",
      owner: {
        userId: "100",
        role: "sales_rep",
        name: "Rep A",
        matchedRegion: true,
        reason: "matched to the us sales territory",
        rankedUserIds: ["100", "101"],
      },
    });
  });

  it("returns contact_not_found when contact is missing", async () => {
    getContactMock.mockResolvedValue(null);

    const result = await resolveHostAtSlot({
      organizationId: "1",
      contactId: "c1",
      startsAt: new Date("2030-01-15T15:00:00.000Z"),
      endsAt: new Date("2030-01-15T15:30:00.000Z"),
    });

    expect(result).toEqual({ available: false, reason: "contact_not_found" });
  });

  it("picks first ranked rep with a free calendar slot", async () => {
    getContactMock.mockResolvedValue({
      id: "c1",
      displayName: "Ada Lovelace",
      person: {
        organizationId: "1",
        email: "ada@example.com",
        businessType: "b2b",
        country: "us",
        companyId: null,
      },
      crm: { locationId: null },
    } as never);

    listCandidatesMock.mockResolvedValue({
      organizationId: "1",
      seniorAmountThreshold: 100_000,
      candidates: [
        {
          id: "100",
          role: "sales_rep",
          displayName: "Rep A",
          email: "a@example.com",
          country: "us",
          businessType: "b2b",
          openDealCount: 1,
          openPipelineAmount: 0,
          closedWonCount: 40,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
        {
          id: "101",
          role: "sales_rep",
          displayName: "Rep B",
          email: "b@example.com",
          country: "us",
          businessType: "b2b",
          openDealCount: 2,
          openPipelineAmount: 0,
          closedWonCount: 10,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
      ],
    });

    mailboxHasCalMock.mockImplementation(async (userId) => userId === "100");
    isSlotFreeMock.mockImplementation(async ({ mailboxUserId }) => {
      return mailboxUserId === "100";
    });

    const result = await resolveHostAtSlot({
      organizationId: "1",
      contactId: "c1",
      startsAt: new Date("2030-01-15T15:00:00.000Z"),
      endsAt: new Date("2030-01-15T15:30:00.000Z"),
    });

    expect(result).toMatchObject({
      available: true,
      hostUserId: "100",
      hostName: "Rep A",
    });
    expect(resolveOwnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        country: "us",
        city: undefined,
      }),
    );
  });

  it("follows the location ranking when the closest rep is busier", async () => {
    getContactMock.mockResolvedValue({
      id: "c1",
      displayName: "Ada Lovelace",
      person: {
        organizationId: "1",
        email: "ada@example.com",
        country: "India",
        city: "Chennai",
        companyId: null,
        locationId: null,
      },
    } as never);

    resolveOwnerMock.mockResolvedValue({
      status: "assigned",
      owner: {
        userId: "200",
        role: "sales_rep",
        name: "Chennai Rep",
        matchedRegion: true,
        reason: "matched Chennai",
        rankedUserIds: ["200", "100"],
      },
    });
    listCandidatesMock.mockResolvedValue({
      organizationId: "1",
      seniorAmountThreshold: 100_000,
      candidates: [
        {
          id: "100",
          role: "sales_rep",
          displayName: "Delhi Rep",
          email: "delhi@example.com",
          country: "India",
          city: "Delhi",
          businessType: "b2b",
          openDealCount: 0,
          openPipelineAmount: 0,
          closedWonCount: 10,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
        {
          id: "200",
          role: "sales_rep",
          displayName: "Chennai Rep",
          email: "chennai@example.com",
          country: "India",
          city: "Chennai",
          businessType: "b2b",
          openDealCount: 4,
          openPipelineAmount: 0,
          closedWonCount: 10,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
      ],
    });
    mailboxHasCalMock.mockResolvedValue(true);
    isSlotFreeMock.mockResolvedValue(true);

    const result = await resolveHostAtSlot({
      organizationId: "1",
      contactId: "c1",
      startsAt: new Date("2030-01-15T15:00:00.000Z"),
      endsAt: new Date("2030-01-15T15:30:00.000Z"),
    });

    expect(result).toMatchObject({
      available: true,
      hostUserId: "200",
      hostName: "Chennai Rep",
      assignmentReason: "matched Chennai",
    });
  });

  it("uses the next ranked rep when the closest rep is busy", async () => {
    getContactMock.mockResolvedValue({
      id: "c1",
      displayName: "Ada Lovelace",
      person: {
        organizationId: "1",
        email: "ada@example.com",
        country: "India",
        city: "Chennai",
        companyId: null,
        locationId: null,
      },
    } as never);
    resolveOwnerMock.mockResolvedValue({
      status: "assigned",
      owner: {
        userId: "200",
        role: "sales_rep",
        name: "Chennai Rep",
        matchedRegion: true,
        reason: "matched Chennai",
        rankedUserIds: ["200", "100"],
      },
    });
    listCandidatesMock.mockResolvedValue({
      organizationId: "1",
      seniorAmountThreshold: 100_000,
      candidates: [
        {
          id: "100",
          role: "sales_rep",
          displayName: "Delhi Rep",
          email: "delhi@example.com",
          country: "India",
          city: "Delhi",
          businessType: "b2b",
          openDealCount: 0,
          openPipelineAmount: 0,
          closedWonCount: 10,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
        {
          id: "200",
          role: "sales_rep",
          displayName: "Chennai Rep",
          email: "chennai@example.com",
          country: "India",
          city: "Chennai",
          businessType: "b2b",
          openDealCount: 4,
          openPipelineAmount: 0,
          closedWonCount: 10,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
      ],
    });
    mailboxHasCalMock.mockResolvedValue(true);
    isSlotFreeMock.mockImplementation(async ({ mailboxUserId }) => mailboxUserId === "100");

    const result = await resolveHostAtSlot({
      organizationId: "1",
      contactId: "c1",
      startsAt: new Date("2030-01-15T15:00:00.000Z"),
      endsAt: new Date("2030-01-15T15:30:00.000Z"),
    });

    expect(result).toMatchObject({
      available: true,
      hostUserId: "100",
      hostName: "Delhi Rep",
    });
  });

  it("returns no_slots_available when every candidate is busy", async () => {
    getContactMock.mockResolvedValue({
      id: "c1",
      displayName: "Ada Lovelace",
      person: {
        organizationId: "1",
        email: "ada@example.com",
        businessType: "b2b",
        country: "us",
        companyId: null,
      },
      crm: { locationId: null },
    } as never);

    listCandidatesMock.mockResolvedValue({
      organizationId: "1",
      seniorAmountThreshold: 100_000,
      candidates: [
        {
          id: "100",
          role: "sales_rep",
          displayName: "Rep A",
          email: "a@example.com",
          country: "us",
          businessType: "b2b",
          openDealCount: 1,
          openPipelineAmount: 0,
          closedWonCount: 40,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
      ],
    });

    mailboxHasCalMock.mockResolvedValue(true);
    isSlotFreeMock.mockResolvedValue(false);

    const result = await resolveHostAtSlot({
      organizationId: "1",
      contactId: "c1",
      startsAt: new Date("2030-01-15T15:00:00.000Z"),
      endsAt: new Date("2030-01-15T15:30:00.000Z"),
    });

    expect(result).toEqual({ available: false, reason: "no_slots_available" });
  });

  it("findAvailableSlotsForDay returns ranked rep slots on the same day", async () => {
    getContactMock.mockResolvedValue({
      id: "c1",
      displayName: "Ada Lovelace",
      person: {
        organizationId: "1",
        email: "ada@example.com",
        businessType: "b2b",
        country: "us",
        companyId: null,
      },
      crm: { locationId: null },
    } as never);

    listCandidatesMock.mockResolvedValue({
      organizationId: "1",
      seniorAmountThreshold: 100_000,
      candidates: [
        {
          id: "100",
          role: "sales_rep",
          displayName: "Rep A",
          email: "a@example.com",
          country: "us",
          businessType: "b2b",
          openDealCount: 1,
          openPipelineAmount: 0,
          closedWonCount: 40,
          acceptingLeads: true,
          maxOpenDeals: null,
          onPto: false,
          seniorityTier: "junior",
        },
      ],
    });

    mailboxHasCalMock.mockResolvedValue(true);
    findFreeSlotsOnDayMock.mockResolvedValue([
      new Date("2030-01-15T11:00:00.000Z"),
      new Date("2030-01-15T14:30:00.000Z"),
    ]);

    const slots = await findAvailableSlotsForDay({
      organizationId: "1",
      contactId: "c1",
      day: new Date("2030-01-15T15:00:00.000Z"),
      timezone: "UTC",
      durationMinutes: 30,
    });

    expect(slots).toEqual([
      {
        startsAt: "2030-01-15T11:00:00.000Z",
        hostUserId: "100",
      },
      {
        startsAt: "2030-01-15T14:30:00.000Z",
        hostUserId: "100",
      },
    ]);
  });
});
