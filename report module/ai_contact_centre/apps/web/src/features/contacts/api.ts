import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";
import type {
  CdpContact,
  ContactCreateInput,
  ContactInteractionsPage,
  ContactListQuery,
  ContactListResponse,
  ContactUpdateInput,
} from "./types";

/** CDP contacts API — `cdp.customer_profile` + `cdp.identity_keys` via cc-core. */
export const contactsApi = {
  async listContacts(query: ContactListQuery = {}): Promise<ContactListResponse> {
    const { data } = await ccCoreHttp.get<ContactListResponse>(apiV1("/cdp/contacts"), {
      params: query,
    });
    return data;
  },

  async getContact(id: string): Promise<{ contact: CdpContact }> {
    const { data } = await ccCoreHttp.get<{ contact: CdpContact }>(`${apiV1(`/cdp/contacts/${id}`)}`);
    return data;
  },

  async createContact(input: ContactCreateInput): Promise<{ contact: CdpContact }> {
    const { data } = await ccCoreHttp.post<{ contact: CdpContact }>(
      apiV1("/cdp/contacts"),
      input,
    );
    return data;
  },

  async updateContact(
    id: string,
    input: ContactUpdateInput,
  ): Promise<{ contact: CdpContact }> {
    const { data } = await ccCoreHttp.patch<{ contact: CdpContact }>(
      `${apiV1(`/cdp/contacts/${id}`)}`,
      input,
    );
    return data;
  },

  async deleteContact(id: string): Promise<{ contact: CdpContact }> {
    const { data } = await ccCoreHttp.delete<{ contact: CdpContact }>(
      `${apiV1(`/cdp/contacts/${id}`)}`,
    );
    return data;
  },

  async listContactInteractions(
    contactId: string,
    options?: { offset?: number; limit?: number },
  ): Promise<ContactInteractionsPage> {
    const { data } = await ccCoreHttp.get<ContactInteractionsPage>(
      `${apiV1(`/cdp/contacts/${contactId}/interactions`)}`,
      {
        params: {
          offset: options?.offset ?? 0,
          limit: options?.limit ?? 10,
        },
      },
    );
    return data;
  },
};
