// /timeline の文字の表示と、表示するタスクの読み取り
import type { Report } from "./records.ts";
import { clip } from "./shared.ts";
import { stateFromBranch } from "./todo-state.ts";
import type { Task } from "./todo-state.ts";

/** 表示するタスク。消したものは含めない */
export type TaskView = Task & { status: "pending" | "in_progress" | "completed" };

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

const STATUS_MARKS = { completed: "✓", in_progress: "◐", pending: "○" } as const;
const RESULT_MAX_CHARS = 200;

/**
 * 最後に記録されたタスクの状態から、消したものを除いて返す。
 * upTo を渡すと、その時刻までに記録された状態に限る（過去の区間のレポートに、後の状態を混ぜないため）。
 */
export function tasksFromBranch(entries: Iterable<unknown>, upTo = Number.POSITIVE_INFINITY): TaskView[] {
	return stateFromBranch(entries, upTo).tasks.filter((task): task is TaskView => task.status !== "deleted");
}

export function taskLines(tasks: readonly TaskView[]): string[] {
	return tasks.flatMap((task) => {
		const active = task.status === "in_progress" && task.activeForm ? `（${task.activeForm}）` : "";
		const head = `${STATUS_MARKS[task.status]} #${task.id} ${task.subject}${active}`;
		const result = task.status === "completed" && task.description ? [`    ${clip(task.description, RESULT_MAX_CHARS)}`] : [];
		return [head, ...result];
	});
}

/** 最初の活動から最後の活動までの時間。どちらかが無ければ空 */
export function elapsedLabel(firstActivity: number | null, lastActivity: number | null): string {
	if (firstActivity === null || lastActivity === null) return "";
	const minutes = Math.max(0, Math.round((lastActivity - firstActivity) / 60_000));
	const hours = Math.floor(minutes / 60);
	return hours > 0 ? `経過 ${hours}時間 ${minutes % 60}分` : `経過 ${minutes}分`;
}

/** 今の作業。進行中のタスクがあればそれ、無ければ最初の未着手。全部終わっていれば undefined */
export function focusOf(tasks: readonly TaskView[]): { task: TaskView; active: boolean } | undefined {
	const active = tasks.find((task) => task.status === "in_progress");
	const task = active ?? tasks.find((task) => task.status === "pending");
	return task === undefined ? undefined : { task, active: active !== undefined };
}

/** 束ねたレポートに含まれる基本のレポートを除き、新しい順に並べる */
export function topLevelReports(reports: readonly Report[]): Report[] {
	const bundled = new Set(reports.flatMap((report) => report.children));
	return reports.filter((report) => !bundled.has(report.id)).sort((left, right) => right.end - left.end || right.level - left.level);
}

export function periodLabel(periodMs: number): string {
	const minutes = Math.round(periodMs / 60_000);
	return minutes % 60 === 0 ? `${minutes / 60}時間` : `${minutes}分`;
}

/** 時刻の表し方。今日でない日には月日を前に付ける */
export function createClock(now: number, timeZone: string | undefined) {
	const time = new Intl.DateTimeFormat("ja-JP", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
	const day = new Intl.DateTimeFormat("ja-JP", { timeZone, month: "2-digit", day: "2-digit" });
	const today = day.format(now);
	const dayPrefix = (at: number): string => (day.format(at) === today ? "" : `${day.format(at)} `);
	return {
		range: (start: number, end: number): string => `${dayPrefix(start)}${time.format(start)}–${time.format(end)}`,
		moment: (at: number): string => `${dayPrefix(at)}${time.format(at)}`,
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

/** 段の間隔の呼び名（「15分」「1時間」） */
export const levelLabel = (report: Report, labels: readonly string[]): string => labels[report.level] ?? `段${report.level + 1}`;

function createHead(input: ClockInput): (report: Report) => string {
	const clock = createClock(input.now, input.timeZone);
	return (report) => `${levelLabel(report, input.levelLabels)} ${clock.range(report.start, report.end)}`;
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
