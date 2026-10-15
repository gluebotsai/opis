import type { HttpClient } from "../http.js";
import type { Customer, CustomerListParams } from "../types.js";

export function createCustomersResource(http: HttpClient) {
  return {
    /** GET /api/customers — requires accessToken. */
    list(params: CustomerListParams = {}): Promise<Customer[]> {
      return http.request<Customer[]>({
        method: "GET",
        path: "/api/customers",
        auth: "accessToken",
        query: params,
      });
    },
  };
}

export type CustomersResource = ReturnType<typeof createCustomersResource>;
