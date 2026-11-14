// タスクとレポートを1枚の HTML にする
import { PAGE_SCRIPT, PAGE_STYLE } from "./html-style.ts";
import type { Report } from "./records.ts";
import { createClock, levelLabel } from "./view.ts";
import type { TaskView } from "./view.ts";

export interface PageInput {
	/** 見出しの下に出す題名（セッションの名前など） */
	title: string | undefined;
	tasks: readonly TaskView[];
	reports: readonly Report[];
	firstActivity: number | null;
	lastActivity: number | null;
	now: number;
	timeZone: string | undefined;
	levelLabels: string[];
}

type Clock = ReturnType<typeof createClock>;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const STATUS_MARKS = { completed: "✓", in_progress: "◐", pending: "○" } as const;
const STATUS_TAGS = { completed: "完了", in_progress: "進行中" } as const;

/** タスク名やレポートの文はモデルが書いたものなので、必ずこれを通してから HTML に入れる */
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (symbol) => ESCAPES[symbol]);

function elapsedLabel(input: PageInput): string {
	if (input.firstActivity === null || input.lastActivity === null) return "";
	const minutes = Math.max(0, Math.round((input.lastActivity - input.firstActivity) / 60_000));
	const hours = Math.floor(minutes / 60);
	return hours > 0 ? `経過 ${hours}時間 ${minutes % 60}分` : `経過 ${minutes}分`;
}

function focusLine(tasks: readonly TaskView[]): string {
	const active = tasks.find((task) => task.status === "in_progress");
	const next = active ?? tasks.find((task) => task.status === "pending");
	if (next === undefined) return "";
	const doing = active?.activeForm ? `（${escapeHtml(active.activeForm)}）` : "";
	return `<div class="now">${active === undefined ? "次" : "今"}: <b>#${next.id} ${escapeHtml(next.subject)}</b>${doing}</div>`;
}

function badgeOf(tasks: readonly TaskView[], done: number): string {
	if (done === tasks.length) return '<span class="badge done">完了</span>';
	const started = done > 0 || tasks.some((task) => task.status === "in_progress");
	return started ? '<span class="badge active">進行中</span>' : '<span class="badge idle">未着手</span>';
}

function progressCard(input: PageInput, done: number): string {
	const percent = Math.round((done / input.tasks.length) * 100);
	return [
		`<div class="card"><div class="progress-head"><span class="label">進捗</span>${badgeOf(input.tasks, done)}</div>`,
		`<div class="bar-row"><div class="bar"><i class="done" style="width:${percent}%"></i></div><div class="percent">${percent}<small>%</small></div></div>`,
		`<div class="progress-foot"><span>${input.tasks.length} 件中 ${done} 件が完了</span><span>${elapsedLabel(input)}</span></div>`,
		`${focusLine(input.tasks)}</div>`,
	].join("");
}

function taskItem(task: TaskView): string {
	const detail = task.status === "completed" ? task.description : task.status === "in_progress" ? task.activeForm : undefined;
	const result = detail && task.status !== "pending" ? `<div class="result"><span class="tag">${STATUS_TAGS[task.status]}</span>${escapeHtml(detail)}</div>` : "";
	return `<li class="${task.status}"><span class="mark">${STATUS_MARKS[task.status]}</span><span class="title">${escapeHtml(task.subject)}</span>${result}</li>`;
}

function tasksSection(input: PageInput, done: number): string {
	if (input.tasks.length === 0) return '<p class="empty">タスクはまだありません</p>';
	return `${progressCard(input, done)}<ul class="tasks">${input.tasks.map(taskItem).join("")}</ul>`;
}

const listOf = (lines: readonly string[]): string => (lines.length === 0 ? "" : `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`);

function notesOf(report: Report): string {
	const open = report.summary.uncertainties.map((line) => `<dt class="open">未解決</dt><dd>${escapeHtml(line)}</dd>`);
	const todo = report.summary.userActions.map((line) => `<dt class="todo">できること</dt><dd>${escapeHtml(line)}</dd>`);
	return open.length + todo.length === 0 ? "" : `<dl class="note">${[...open, ...todo].join("")}</dl>`;
}

function childrenOf(report: Report, input: PageInput, clock: Clock): string {
	const children = input.reports.filter((child) => report.children.includes(child.id)).sort((left, right) => right.end - left.end);
	if (children.length === 0) return "";
	const lines = children.map((child) => `${clock.range(child.start, child.end)} ${child.summary.progress[0]}`);
	return `<details><summary>含まれる ${escapeHtml(input.levelLabels[0] ?? "")}のレポート ${children.length} 件</summary>${listOf(lines)}</details>`;
}

function reportArticle(report: Report, input: PageInput, clock: Clock): string {
	const [lead, ...rest] = report.summary.progress;
	const head = `<span class="time">${clock.range(report.start, report.end)}</span><span class="level">${escapeHtml(levelLabel(report, input.levelLabels))}</span><span>ツール ${report.toolCount} 回</span>`;
	return [
		`<article class="report${report.level > 0 ? " rollup" : ""}"><div class="report-head">${head}</div>`,
		`<div class="lead">${escapeHtml(lead ?? "")}</div>${listOf(rest)}${notesOf(report)}${childrenOf(report, input, clock)}</article>`,
	].join("");
}

/** 束ねたレポートに含まれる基本のレポートは外に並べず、新しい順に出す */
function reportsSection(input: PageInput, clock: Clock): string {
	if (input.reports.length === 0) return '<p class="empty">レポートはまだありません</p>';
	const bundled = new Set(input.reports.flatMap((report) => report.children));
	const visible = input.reports.filter((report) => !bundled.has(report.id)).sort((left, right) => right.end - left.end || right.level - left.level);
	return `<div class="reports">${visible.map((report) => reportArticle(report, input, clock)).join("")}</div>`;
}

function tabs(input: PageInput, done: number): string {
	const taskCount = input.tasks.length === 0 ? "" : `<span class="count">${done}/${input.tasks.length}</span>`;
	const reportCount = `<span class="count">${input.reports.length}</span>`;
	return `<div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-tab="tasks">タスク${taskCount}</button><button role="tab" aria-selected="false" data-tab="reports">レポート${reportCount}</button></div>`;
}

/** 外の資源を読み込まない、1枚で完結した HTML を返す */
export function renderPage(input: PageInput): string {
	const clock = createClock(input.now, input.timeZone);
	const done = input.tasks.filter((task) => task.status === "completed").length;
	const title = input.title ? `<div class="sub">${escapeHtml(input.title)}</div>` : "";
	const updated = input.lastActivity === null ? "" : `<div class="updated">記録の最後 ${clock.moment(input.lastActivity)}</div>`;
	return [
		'<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>タイムライン</title>',
		`<style>${PAGE_STYLE}</style></head><body><h1>タイムライン</h1>${title}${tabs(input, done)}`,
		`<section id="tasks">${tasksSection(input, done)}</section><section id="reports" hidden>${reportsSection(input, clock)}</section>`,
		`${updated}<script>${PAGE_SCRIPT}</script></body></html>`,
	].join("\n");
}
