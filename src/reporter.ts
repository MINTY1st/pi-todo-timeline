// 期限の来たレポートを作る
import type { TimelineConfig } from "./config.ts";
import { collectDelta } from "./delta.ts";
import { buildBaseRequest, buildRepairRequest, buildRollupRequest, parseSummary } from "./prompt.ts";
import type { ModelRequest, PromptSettings } from "./prompt.ts";
import { reportsFromBranch } from "./records.ts";
import type { Report, Summary } from "./records.ts";
import { isBaseDue, lastBaseEnd, rollupChildren } from "./schedule.ts";
import { taskLines, tasksFromBranch } from "./view.ts";

export interface ReporterDependencies {
	/** モデルに依頼を送り、返答の文を返す */
	complete(request: ModelRequest, signal: AbortSignal): Promise<string>;
	now(): number;
	newId(): string;
}

export interface ProduceInput {
	entries: readonly unknown[];
	config: TimelineConfig;
	/** true なら基本のレポートを期限の前でも作る */
	force: boolean;
}

export interface ProduceResult {
	/** 作れたレポート。途中で失敗しても、それまでに作れた分は入る */
	reports: Report[];
	error: string | undefined;
}

interface Work {
	input: ProduceInput;
	settings: PromptSettings;
	dependencies: ReporterDependencies;
	signal: AbortSignal;
}

/** 返答を要約として読む。決まりに合わなければ、理由を付けて1回だけ直しを頼む */
async function summarize(request: ModelRequest, work: Work): Promise<Summary> {
	const draft = await work.dependencies.complete(request, work.signal);
	try {
		return parseSummary(draft, work.settings.maxLineChars);
	} catch (error) {
		const repair = buildRepairRequest({ draft, issue: (error as Error).message, settings: work.settings });
		return parseSummary(await work.dependencies.complete(repair, work.signal), work.settings.maxLineChars);
	}
}

async function produceBase(work: Work, known: readonly Report[]): Promise<Report | undefined> {
	const { config, entries, force } = work.input;
	const delta = collectDelta(entries, lastBaseEnd(known), { maxChars: config.maxInputChars, maxItemChars: config.maxItemChars });
	if (delta.start === null || delta.end === null) return undefined;
	if (!force && !isBaseDue(delta.start, work.dependencies.now(), config.intervalMs)) return undefined;
	const previous = [...known].reverse().find((report) => report.level === 0)?.summary;
	const request = buildBaseRequest({ start: delta.start, end: delta.end, deltaText: delta.text, previous, taskLines: taskLines(tasksFromBranch(entries)), settings: work.settings });
	const summary = await summarize(request, work);
	return { version: 1, id: work.dependencies.newId(), level: 0, start: delta.start, end: delta.end, createdAt: work.dependencies.now(), toolCount: delta.toolCount, children: [], summary };
}

async function produceRollup(work: Work, reports: readonly Report[]): Promise<Report | undefined> {
	const { config } = work.input;
	const children = rollupChildren(reports, work.dependencies.now(), config.intervalMs * config.rollupFactor);
	if (children.length === 0) return undefined;
	const summary = await summarize(buildRollupRequest({ children, settings: work.settings }), work);
	return {
		version: 1,
		id: work.dependencies.newId(),
		level: 1,
		start: children[0].start,
		end: children[children.length - 1].end,
		createdAt: work.dependencies.now(),
		toolCount: children.reduce((sum, child) => sum + child.toolCount, 0),
		children: children.map((child) => child.id),
		summary,
	};
}

/** 基本のレポート、続けて束ねたレポートの順に、期限の来たものを作る */
export async function produceReports(input: ProduceInput, dependencies: ReporterDependencies, signal: AbortSignal): Promise<ProduceResult> {
	const { config } = input;
	const work: Work = { input, dependencies, signal, settings: { language: config.language, maxLineChars: config.maxLineChars, focus: config.focus } };
	const known = reportsFromBranch(input.entries);
	const reports: Report[] = [];
	try {
		const base = await produceBase(work, known);
		if (base !== undefined) reports.push(base);
		const rollup = await produceRollup(work, [...known, ...reports]);
		if (rollup !== undefined) reports.push(rollup);
		return { reports, error: undefined };
	} catch (error) {
		return { reports, error: error instanceof Error ? error.message : String(error) };
	}
}
