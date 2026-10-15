import { apiV1 } from "@/config/api-paths";
import { platformHttp } from "@/services/http";

/** Platform Services client — org/users/teams/hours (read via platform-service). */
export const platformApi = {
  async listUsers() {
    const { data } = await platformHttp.get(apiV1("/users"));
    return data;
  },

  async listProducts() {
    const { data } = await platformHttp.get(apiV1("/products"));
    return data;
  },
};
