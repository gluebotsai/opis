import { api } from "./api";

export type CompanyListItem = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  locationCount: number;
  logoUrl: string | null;
  createdAt: string;
  expansionSignal: string | null;
};

/** First paint and each later page of the Companies screen. */
export const COMPANY_LIST_PAGE_SIZE = 20;

export async function fetchCompaniesPage(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const { data } = await api.get<{
    ok: true;
    items: CompanyListItem[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasNext?: boolean;
    };
  }>("/api/companies", { params });
  return data;
}

export async function fetchCompanyFormOptions() {
  const { data } = await api.get("/api/companies/form-options");
  return data as
    | {
        ok: true;
        canAssignOwner: boolean;
        currentUserId: string | null;
        assignableUsers: Array<{ id: string; label: string }>;
      }
    | { ok: false; error: string };
}

export async function fetchCompany(id: string) {
  const { data } = await api.get(`/api/companies/${id}`);
  return data as
    | {
        ok: true;
        company: {
          id: string;
          name: string;
          domain: string | null;
          industry: string | null;
          employeeCount: number | null;
          linkedinUrl: string | null;
          ownerUserId: string | null;
          channelRole?: string;
          parentCompanyId?: string | null;
          locations: Array<{
            id: string;
            name: string;
            type: string;
            address: string | null;
            city: string | null;
            industry: string | null;
            ownerUserId: string | null;
          }>;
        };
        canAssignOwner: boolean;
        assignableUsers: Array<{ id: string; label: string }>;
      }
    | { ok: false; error: string };
}

export async function createCompany(body: {
  name: string;
  domain?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  linkedinUrl?: string | null;
  ownerUserId?: string | null;
  channelRole?: string | null;
  parentCompanyId?: string | null;
  locationName: string;
  locationAddress?: string | null;
  locationType?: "hq" | "branch";
}) {
  const { data } = await api.post("/api/companies", body);
  return data as
    | { ok: true; id: string }
    | { ok: false; error: string; existingId?: string };
}

export async function updateCompany(
  id: string,
  body: {
    name: string;
    domain?: string | null;
    industry?: string | null;
    employeeCount?: number | null;
    linkedinUrl?: string | null;
    ownerUserId?: string | null;
    channelRole?: string | null;
    parentCompanyId?: string | null;
  },
) {
  const { data } = await api.patch(`/api/companies/${id}`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function deleteCompany(id: string) {
  const { data } = await api.delete(`/api/companies/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export type LocationInputBody = {
  name: string;
  type: "hq" | "branch";
  address?: string | null;
  city?: string | null;
  industry?: string | null;
  ownerUserId?: string | null;
};

export async function createLocation(companyId: string, body: LocationInputBody) {
  const { data } = await api.post(`/api/companies/${companyId}/locations`, body);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function updateLocation(
  companyId: string,
  locationId: string,
  body: LocationInputBody,
) {
  const { data } = await api.patch(
    `/api/companies/${companyId}/locations/${locationId}`,
    body,
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export async function deleteLocation(companyId: string, locationId: string) {
  const { data } = await api.delete(
    `/api/companies/${companyId}/locations/${locationId}`,
  );
  return data as { ok: true; id: string } | { ok: false; error: string };
}

export type LocationCard = {
  id: string;
  name: string;
  type: "hq" | "branch";
  address: string | null;
  city: string | null;
  ownerName: string | null;
  leadCount: number;
  dealCount: number;
  customerCount: number;
};

export type CompanyContactRow = {
  id: string;
  displayName: string;
  email: string;
  title: string | null;
  contactType: string;
  status: string;
};

export async function fetchCompanyLocations(companyId: string) {
  const { data } = await api.get(`/api/companies/${companyId}/locations`);
  return data as
    | {
        ok: true;
        companyId: string;
        companyName: string;
        locations: LocationCard[];
        contacts: CompanyContactRow[];
        contactTotal: number;
        expansionSignal: string | null;
        expansionReason: string | null;
        expansionDraft: string | null;
        expansionLastRunAt: string | null;
      }
    | { ok: false; error: string };
}

export type LocationDetail = {
  id: string;
  name: string;
  type: "hq" | "branch";
  address: string | null;
  city: string | null;
  industry: string | null;
  employeeCount: number | null;
  ownerUserId: string | null;
  companyIndustry: string | null;
  companyEmployeeCount: number | null;
};

export async function fetchLocation(companyId: string, locationId: string) {
  const { data } = await api.get(
    `/api/companies/${companyId}/locations/${locationId}`,
  );
  return data as
    | {
        ok: true;
        companyId: string;
        companyName: string;
        location: LocationDetail;
        contacts: CompanyContactRow[];
      }
    | { ok: false; error: string };
}

export type LocationFormOptions = {
  ok: true;
  companyId: string;
  companyName: string;
  hasHq: boolean;
  canAssignOwner: boolean;
  currentUserId: string | null;
  assignableUsers: Array<{ id: string; label: string }>;
  location: {
    id: string;
    name: string;
    type: "hq" | "branch";
    address: string | null;
    industry: string | null;
    ownerUserId: string | null;
  } | null;
};

export async function fetchLocationFormOptions(
  companyId: string,
  locationId?: string,
) {
  const { data } = await api.get(
    `/api/companies/${companyId}/locations/form-options`,
    { params: locationId ? { locationId } : undefined },
  );
  return data as LocationFormOptions | { ok: false; error: string };
}
