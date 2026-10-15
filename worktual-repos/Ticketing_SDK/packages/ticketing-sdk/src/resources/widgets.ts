import type { HttpClient } from "../http.js";
import type {
  HelpWidget,
  HelpWidgetCreateInput,
  HelpWidgetEmbed,
  HelpWidgetPublic,
  HelpWidgetTicketInput,
  HelpWidgetUpdateInput,
  IntakeTicketResult,
} from "../types.js";

export function createWidgetsResource(http: HttpClient) {
  return {
    /** Partner key. Lists help widgets for this org. */
    list(tenantId?: string): Promise<{ widgets: HelpWidget[] }> {
      return http.request({
        method: "GET",
        path: "/api/sdk/widgets",
        auth: "partnerKey",
        query: { tenantId },
      });
    },

    /** Partner key. Creates a widget and returns the script and iframe snippets. */
    create(input: HelpWidgetCreateInput = {}): Promise<{ widget: HelpWidget; embed: HelpWidgetEmbed }> {
      return http.request({
        method: "POST",
        path: "/api/sdk/widgets",
        auth: "partnerKey",
        body: input,
      });
    },

    /** Partner key. Updates name, origins, label, or enabled. */
    update(
      id: string,
      input: HelpWidgetUpdateInput
    ): Promise<{ widget: HelpWidget; embed: HelpWidgetEmbed }> {
      return http.request({
        method: "PATCH",
        path: `/api/sdk/widgets/${encodeURIComponent(id)}`,
        auth: "partnerKey",
        body: input,
      });
    },

    /** Public. No API key. Reads the button label for `wgt_…`. */
    getPublic(publicId: string): Promise<HelpWidgetPublic> {
      return http.request({
        method: "GET",
        path: `/api/public/widgets/${encodeURIComponent(publicId)}`,
        auth: "none",
      });
    },

    /** Public. No API key. Files a web-form ticket for `wgt_…`. */
    submitTicket(publicId: string, input: HelpWidgetTicketInput): Promise<IntakeTicketResult> {
      return http.request({
        method: "POST",
        path: `/api/public/widgets/${encodeURIComponent(publicId)}/tickets`,
        auth: "none",
        body: input,
      });
    },
  };
}

export type WidgetsResource = ReturnType<typeof createWidgetsResource>;
