// レポートの型と、セッションの記録からの復元
import { isObject } from "./shared.ts";

export const REPORT_ENTRY_TYPE = "pi-timeline-report";

export interface Summary {
	progress: string[];
	uncertainties: string[];
	userActions: string[];
}

export interface Report {
	version: 1;
	id: string;
	/** 0 が基本のレポート、1 がそれを束ねたレポート */
	level: number;
	start: number;
	end: number;
	createdAt: number;
	toolCount: number;
	children: string[];
	summary: Summary;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isCount = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

export function isSummary(value: unknown): value is Summary {
	if (!isObject(value)) return false;
	return isStringArray(value.progress) && value.progress.length > 0 && isStringArray(value.uncertainties) && isStringArray(value.userActions);
}

export function isReport(value: unknown): value is Report {
	if (!isObject(value) || value.version !== 1 || typeof value.id !== "string") return false;
	const numbers = [value.level, value.start, value.end, value.createdAt, value.toolCount];
	return numbers.every(isCount) && isStringArray(value.children) && isSummary(value.summary);
}

/** ブランチを古い順にたどり、形の正しいレポートだけを返す。壊れた記録は飛ばす */
export function reportsFromBranch(entries: Iterable<unknown>): Report[] {
	const reports: Report[] = [];
	for (const entry of entries) {
		if (!isObject(entry) || entry.type !== "custom" || entry.customType !== REPORT_ENTRY_TYPE) continue;
		if (isReport(entry.data)) reports.push(entry.data);
	}
	return reports;
}
