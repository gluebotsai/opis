import { type ClickHouseClient, type Row } from "../../plugins/clickhouse.js";
import type { OrganizationBusinessType } from "../../utils/organizationBusinessType.js";
export declare function getVisitorSegmentation(client: ClickHouseClient, websiteId: number, period: string, pageEngagementThresholdPct?: number, organizationBusinessType?: OrganizationBusinessType | null): Promise<Row>;
