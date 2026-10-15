export type SegmentationSegmentRow = {
    label: string;
    visitors: number;
    percentage: number;
};
export declare function buildVisitorSegments(rows: {
    label: string;
    visitors: number;
}[]): SegmentationSegmentRow[];
export declare function buildEventSegments(rows: {
    label: string;
    events: number;
}[]): {
    label: string;
    events: number;
    percentage: number;
}[];
