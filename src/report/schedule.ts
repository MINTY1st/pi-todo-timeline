// レポートを作る時期の判定
import type { Report } from "./records.ts";

/** まだ報告していない最初の活動から間隔が経っていれば、基本のレポートの期限 */
export function isBaseDue(deltaStart: number | null, now: number, intervalMs: number): boolean {
	return deltaStart !== null && now - deltaStart >= intervalMs;
}

/** 最後の基本のレポートが覆った時刻。次の差分はこれより後から始める */
export function lastBaseEnd(reports: readonly Report[]): number {
	return reports.reduce((end, report) => (report.level === 0 ? Math.max(end, report.end) : end), 0);
}

/** まだ束ねていない基本のレポートを古い順に返す。最初の1件の開始から期間が経つまでは空 */
export function rollupChildren(reports: readonly Report[], now: number, periodMs: number): Report[] {
	const bundled = new Set(reports.filter((report) => report.level === 1).flatMap((report) => report.children));
	const available = reports.filter((report) => report.level === 0 && !bundled.has(report.id)).sort((left, right) => left.start - right.start);
	const first = available[0];
	return first !== undefined && now - first.start >= periodMs ? available : [];
}
