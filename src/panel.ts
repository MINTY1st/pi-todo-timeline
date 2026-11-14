// 入力欄の上に出すパネル（色つきの文字の行）
import type { Report } from "./records.ts";
import { clip, withoutControls } from "./shared.ts";
import { elapsedLabel, focusOf, reportHead, topLevelReports } from "./view.ts";
import type { TaskView } from "./view.ts";

export interface PanelInput {
	tasks: readonly TaskView[];
	reports: readonly Report[];
	firstActivity: number | null;
	lastActivity: number | null;
	now: number;
	timeZone: string | undefined;
	levelLabels: string[];
	pagePath: string | undefined;
	/** 並べるタスクの上限。超えた分は件数だけ示す */
	maxTasks: number;
}

const ESCAPE = String.fromCharCode(27);
const COLORS = { bold: 1, dim: 2, green: 32, yellow: 33, cyan: 36 } as const;
const BAR_WIDTH = 20;
/** 完了の結果を、パネルで1行に収まる長さで切る。全文はページで読む */
const RESULT_MAX_CHARS = 80;
/** 最新のレポートより前のものを、1行で何件まで出すか */
const EARLIER_REPORTS = 5;

const paint = (color: keyof typeof COLORS, text: string): string => `${ESCAPE}[${COLORS[color]}m${text}${ESCAPE}[0m`;
/** タスク名やレポートの文はモデルが書いたものなので、制御文字を取り除いてから出す */
const safe = (value: string): string => withoutControls(value);

function progressLines(input: PanelInput): string[] {
	const done = input.tasks.filter((task) => task.status === "completed").length;
	const filled = Math.round((done / input.tasks.length) * BAR_WIDTH);
	const bar = `${paint("green", "█".repeat(filled))}${paint("dim", "░".repeat(BAR_WIDTH - filled))}`;
	const elapsed = elapsedLabel(input.firstActivity, input.lastActivity);
	const head = `${paint("bold", "進捗")} ${bar} ${Math.round((done / input.tasks.length) * 100)}%  ${done}/${input.tasks.length} 完了${elapsed === "" ? "" : ` · ${elapsed}`}`;
	const focus = focusOf(input.tasks);
	if (focus === undefined) return [head];
	const doing = focus.active && focus.task.activeForm ? `（${safe(focus.task.activeForm)}）` : "";
	return [head, `${paint("bold", focus.active ? "今" : "次")}   #${focus.task.id} ${safe(focus.task.subject)}${doing}`];
}

function taskLine(task: TaskView): string[] {
	const label = `#${task.id} ${safe(task.subject)}`;
	if (task.status === "pending") return [paint("dim", `○ ${label}`)];
	if (task.status === "in_progress") return [`${paint("cyan", "◐")} ${label}`];
	const result = task.description ? [paint("dim", `    ${clip(safe(task.description), RESULT_MAX_CHARS)}`)] : [];
	return [`${paint("green", "✓")} ${label}`, ...result];
}

/** 終わっていないタスクを優先して上限まで選ぶ。余った枠には、新しい完了から入れる */
function selectTasks(tasks: readonly TaskView[], maxTasks: number): TaskView[] {
	const open = tasks.filter((task) => task.status !== "completed").slice(0, maxTasks);
	const room = maxTasks - open.length;
	const done = room > 0 ? tasks.filter((task) => task.status === "completed").slice(-room) : [];
	const chosen = new Set([...open, ...done]);
	return tasks.filter((task) => chosen.has(task));
}

function omittedLine(tasks: readonly TaskView[], shown: readonly TaskView[]): string[] {
	const hidden = tasks.filter((task) => !shown.includes(task));
	if (hidden.length === 0) return [];
	const done = hidden.filter((task) => task.status === "completed").length;
	const parts = [done > 0 ? `完了 ${done}` : "", hidden.length - done > 0 ? `未完了 ${hidden.length - done}` : ""].filter((part) => part !== "");
	return [paint("dim", `  ほか ${hidden.length} 件（${parts.join("、")}）`)];
}

function tasksSection(input: PanelInput): string[] {
	if (input.tasks.length === 0) return [];
	const shown = selectTasks(input.tasks, input.maxTasks);
	return [...progressLines(input), "", ...shown.flatMap(taskLine), ...omittedLine(input.tasks, shown)];
}

function reportsSection(input: PanelInput): string[] {
	const ordered = topLevelReports(input.reports);
	const latest = ordered.find((report) => report.level === 0) ?? ordered[0];
	if (latest === undefined) return [];
	const head = (report: Report): string => paint("bold", reportHead(report, input));
	const earlier = ordered.filter((report) => report !== latest && report.end <= latest.end).slice(0, EARLIER_REPORTS);
	return [
		`${head(latest)}  ${paint("dim", `ツール ${latest.toolCount} 回`)}`,
		...latest.summary.progress.map((line) => `  ・${safe(line)}`),
		...latest.summary.uncertainties.map((line) => `  ${paint("yellow", "未解決")} ${safe(line)}`),
		...latest.summary.userActions.map((line) => `  ${paint("cyan", "できること")} ${safe(line)}`),
		...earlier.map((report) => `${head(report)}  ${safe(report.summary.progress[0] ?? "")}`),
	];
}

/** タスクのパネル（ボタン timeline）。進捗、今の作業、タスクと結果。タスクが無ければ空（パネルを出さない） */
export function renderTasksPanel(input: PanelInput): string[] {
	return tasksSection(input);
}

/** レポートのパネル（ボタン reports）。最新のレポート、それより前のレポート、ページの場所。レポートが無ければ空 */
export function renderReportsPanel(input: PanelInput): string[] {
	const reports = reportsSection(input);
	if (reports.length === 0) return [];
	return input.pagePath === undefined ? reports : [...reports, "", paint("dim", `ページ ${input.pagePath}`)];
}
