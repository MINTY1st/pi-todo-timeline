// /timeline の表示と、rpiv-todo の記録からのタスクの読み取り
import type { Report } from "./records.ts";
import { clip, isObject } from "./shared.ts";
import type { Fields } from "./shared.ts";

export interface TaskView {
	id: number;
	subject: string;
	status: "pending" | "in_progress" | "completed";
	description?: string;
	activeForm?: string;
}

export interface ViewInput {
	tasks: readonly TaskView[];
	reports: readonly Report[];
	now: number;
	/** 時刻を表すタイムゾーン。undefined なら実行している環境のもの */
	timeZone: string | undefined;
	/** 段ごとの間隔の呼び名。[基本, 束ね] */
	levelLabels: string[];
	maxReports: number;
	notes: string[];
}

/** @juicesharp/rpiv-todo がタスクの状態を書く記録の種類。入っていなければタスクは出さない */
const TODO_STATE_ENTRY_TYPE = "rpiv-todo-state";
const TASK_STATUSES = new Set(["pending", "in_progress", "completed", "deleted"]);
const STATUS_MARKS = { completed: "✓", in_progress: "◐", pending: "○" } as const;
const RESULT_MAX_CHARS = 200;

const isOptionalText = (value: unknown): boolean => value === undefined || typeof value === "string";

function isStoredTask(value: unknown): value is Fields {
	if (!isObject(value)) return false;
	return Number.isSafeInteger(value.id) && typeof value.subject === "string" && TASK_STATUSES.has(value.status as string) && isOptionalText(value.description) && isOptionalText(value.activeForm);
}

/** 最後に記録された形の正しいタスクの状態から、消したものを除いて返す */
export function tasksFromBranch(entries: Iterable<unknown>): TaskView[] {
	let latest: Fields[] = [];
	for (const entry of entries) {
		if (!isObject(entry) || entry.type !== "custom" || entry.customType !== TODO_STATE_ENTRY_TYPE || !isObject(entry.data)) continue;
		const stored = entry.data.tasks;
		if (Array.isArray(stored) && stored.every(isStoredTask)) latest = stored;
	}
	return latest.filter((task) => task.status !== "deleted") as unknown as TaskView[];
}

export function taskLines(tasks: readonly TaskView[]): string[] {
	return tasks.flatMap((task) => {
		const active = task.status === "in_progress" && task.activeForm ? `（${task.activeForm}）` : "";
		const head = `${STATUS_MARKS[task.status]} #${task.id} ${task.subject}${active}`;
		const result = task.status === "completed" && task.description ? [`    ${clip(task.description, RESULT_MAX_CHARS)}`] : [];
		return [head, ...result];
	});
}

export function periodLabel(periodMs: number): string {
	const minutes = Math.round(periodMs / 60_000);
	return minutes % 60 === 0 ? `${minutes / 60}時間` : `${minutes}分`;
}

function createClock(now: number, timeZone: string | undefined) {
	const time = new Intl.DateTimeFormat("ja-JP", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
	const day = new Intl.DateTimeFormat("ja-JP", { timeZone, month: "2-digit", day: "2-digit" });
	const today = day.format(now);
	return (report: Report): string => {
		const prefix = day.format(report.start) === today ? "" : `${day.format(report.start)} `;
		return `${prefix}${time.format(report.start)}–${time.format(report.end)}`;
	};
}

function detailLines(report: Report, head: string): string[] {
	return [
		`  ${head}（ツール ${report.toolCount} 回）`,
		...report.summary.progress.map((line) => `    ・${line}`),
		...report.summary.uncertainties.map((line) => `    未解決: ${line}`),
		...report.summary.userActions.map((line) => `    できること: ${line}`),
	];
}

type ClockInput = Pick<ViewInput, "now" | "timeZone" | "levelLabels">;

function createHead(input: ClockInput): (report: Report) => string {
	const range = createClock(input.now, input.timeZone);
	return (report) => `${input.levelLabels[report.level] ?? `段${report.level + 1}`} ${range(report)}`;
}

/** レポートの見出し。段の間隔と、覆った時刻の範囲 */
export function reportHead(report: Report, input: ClockInput): string {
	return createHead(input)(report);
}

function reportLines(input: ViewInput): string[] {
	if (input.reports.length === 0) return ["レポートはまだありません"];
	const head = createHead(input);
	const newestFirst = [...input.reports].sort((left, right) => right.end - left.end || right.level - left.level);
	const latest = newestFirst.find((report) => report.level === 0) ?? newestFirst[0];
	const others = newestFirst.filter((report) => report !== latest);
	const shown = others.slice(0, Math.max(0, input.maxReports - 1));
	const hidden = others.length - shown.length;
	return [
		"レポート",
		...detailLines(latest, head(latest)),
		...shown.map((report) => `  ${head(report)}  ${report.summary.progress[0]}`),
		...(hidden > 0 ? [`  ほか ${hidden} 件`] : []),
	];
}

/** タスク、レポート、添え書きの順に並べた表示を作る。無い欄は省く */
export function renderTimeline(input: ViewInput): string {
	const done = input.tasks.filter((task) => task.status === "completed").length;
	const taskSection = input.tasks.length === 0 ? [] : [`タスク ${done}/${input.tasks.length} 完了`, ...taskLines(input.tasks).map((line) => `  ${line}`)];
	const sections = [taskSection, reportLines(input), input.notes].filter((section) => section.length > 0);
	return ["タイムライン", sections.map((section) => section.join("\n")).join("\n\n")].join("\n");
}
