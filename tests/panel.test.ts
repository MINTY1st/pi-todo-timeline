import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReportsPanel, renderTasksPanel } from "../src/view/panel.ts";
import type { Report } from "../src/report/records.ts";
import type { TaskView } from "../src/todo/tasks.ts";
import { baseReport, ESCAPE, ms, plain, report, sampleTasks } from "./fixtures.ts";

const colored = (code: number, text: string) => `${ESCAPE}[${code}m${text}${ESCAPE}[0m`;
const tasks = sampleTasks;
const base = baseReport;
const input = (overrides: Record<string, unknown> = {}) => ({
	tasks,
	reports: [] as Report[],
	firstActivity: ms("10:00"),
	lastActivity: ms("10:45"),
	now: ms("12:00"),
	timeZone: "UTC",
	levelLabels: ["15分", "1時間"],
	pagePath: undefined as string | undefined,
	maxTasks: 10,
	...overrides,
});

test("タスクのパネルは、先頭に進捗のバーと割合・完了数・経過、続けて今の作業を出す", () => {
	const lines = plain(renderTasksPanel(input()));
	assert.equal(lines[0], "進捗 ███████░░░░░░░░░░░░░ 33%  1/3 完了 · 経過 45分");
	assert.equal(lines[1], "今   #2 修正する（同期処理を修正中）");
	assert.equal(plain(renderTasksPanel(input({ tasks: [tasks[0], tasks[2]] })))[1], "次   #3 PR を作る");
	assert.equal(plain(renderTasksPanel(input({ tasks: [tasks[0]] })))[0], "進捗 ████████████████████ 100%  1/1 完了 · 経過 45分");
});

test("タスクは状態の印と番号つきで並べ、完了には結果を添え、状態ごとに色を付ける", () => {
	const lines = renderTasksPanel(input());
	assert.deepEqual(plain(lines).slice(2), ["", "✓ #1 不具合を再現する", "    失敗するテストを足した", "◐ #2 修正する", "○ #3 PR を作る"]);
	assert.ok(lines[3].startsWith(colored(32, "✓")), "完了は緑");
	assert.ok(lines[5].startsWith(colored(36, "◐")), "進行中は水色");
	assert.equal(lines[6], colored(2, "○ #3 PR を作る"), "未着手は薄く");
});

test("完了の結果は、1行に収まる長さで切る（全文はページで読む）", () => {
	const long: TaskView[] = [{ id: 1, subject: "長い結果", status: "completed", description: "あ".repeat(120) }];
	assert.equal(plain(renderTasksPanel(input({ tasks: long })))[3], `    ${"あ".repeat(80)}…`);
});

test("タスクが多いときは終わっていないものを優先し、省いた件数を示す", () => {
	const many: TaskView[] = [
		...Array.from({ length: 4 }, (_, index) => ({ id: index + 1, subject: `済み${index + 1}`, status: "completed" as const })),
		...Array.from({ length: 3 }, (_, index) => ({ id: index + 5, subject: `残り${index + 5}`, status: "pending" as const })),
	];
	const lines = plain(renderTasksPanel(input({ tasks: many, maxTasks: 4 })));
	assert.deepEqual(lines.slice(3), ["✓ #4 済み4", "○ #5 残り5", "○ #6 残り6", "○ #7 残り7", "  ほか 3 件（完了 3）"]);
});

test("タスクのパネルにはレポートもページの場所も入れず、タスクが無ければ出さない", () => {
	const lines = plain(renderTasksPanel(input({ reports: [base("a", "10:00", "10:15", "原因を特定した")], pagePath: "/work/x.html" })));
	assert.equal(lines.some((line) => line.includes("原因を特定した") || line.includes("ページ")), false);
	assert.deepEqual(renderTasksPanel(input({ tasks: [], reports: [base("a", "10:00", "10:15", "原因を特定した")] })), []);
});

test("レポートのパネルは、最新の基本のレポートを3つの欄で、それより前を新しい順に5件まで1行で出す", () => {
	const latest = report({ id: "z", start: ms("11:30"), end: ms("11:45"), toolCount: 7, summary: { progress: ["PR を作った", "CI は合格"], uncertainties: ["旧形式を移すか未定"], userActions: ["PR を確認する"] } }) as Report;
	const rollup = report({ id: "p", level: 1, start: ms("10:00"), end: ms("10:30"), children: ["a", "b"], summary: { progress: ["不具合を直した"], uncertainties: [], userActions: [] } }) as Report;
	const older = ["10:30", "10:45", "11:00", "11:15"].map((start, index) => base(`c${index}`, start, ["10:45", "11:00", "11:15", "11:30"][index], `作業${index}`));
	const reports = [base("a", "10:00", "10:15", "原因を特定した"), base("b", "10:15", "10:30", "修正した"), rollup, base("old", "09:00", "09:15", "古い作業"), ...older, latest];
	const lines = renderReportsPanel(input({ reports }));
	assert.deepEqual(plain(lines), [
		"15分 11:30–11:45  ツール 7 回",
		"  ・PR を作った",
		"  ・CI は合格",
		"  未解決 旧形式を移すか未定",
		"  できること PR を確認する",
		"15分 11:15–11:30  作業3",
		"15分 11:00–11:15  作業2",
		"15分 10:45–11:00  作業1",
		"15分 10:30–10:45  作業0",
		"1時間 10:00–10:30  不具合を直した",
	]);
	assert.ok(lines[3].includes(colored(33, "未解決")), "未解決は黄");
	assert.ok(lines[4].includes(colored(36, "できること")), "できることは水色");
});

test("レポートのパネルの末尾にページの場所を添え、レポートが無ければ出さない", () => {
	const lines = plain(renderReportsPanel(input({ reports: [base("a", "10:00", "10:15", "原因を特定した")], pagePath: "/work/.pi/timeline/x.html" })));
	assert.deepEqual(lines.slice(-2), ["", "ページ /work/.pi/timeline/x.html"]);
	assert.deepEqual(renderReportsPanel(input({ reports: [], pagePath: "/work/x.html" })), []);
});

test("件名やレポートの文に制御文字が混ざっていても、色や画面を乱さないよう取り除く", () => {
	const hostile = `危険${ESCAPE}[31m赤${ESCAPE}[2J\u0007な件名`;
	const taskLines = renderTasksPanel(input({ tasks: [{ id: 1, subject: hostile, status: "pending" }] }));
	const reportLines = renderReportsPanel(input({ reports: [base("a", "10:00", "10:15", hostile)] }));
	const all = [...taskLines, ...reportLines].join("\n");
	assert.equal(all.includes(`${ESCAPE}[31m`) || all.includes(`${ESCAPE}[2J`), false);
	assert.ok(plain(taskLines).includes("○ #1 危険[31m赤[2Jな件名"));
	assert.ok(plain(reportLines)[1].includes("危険[31m赤[2Jな件名"));
});
