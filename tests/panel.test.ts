import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPanel } from "../src/panel.ts";
import type { Report } from "../src/records.ts";
import type { TaskView } from "../src/view.ts";
import { ms, report } from "./fixtures.ts";

const ESCAPE = String.fromCharCode(27);
const plain = (lines: string[]) => lines.map((line) => line.replaceAll(new RegExp(`${ESCAPE}\\[[0-9;]*m`, "g"), ""));
const colored = (code: number, text: string) => `${ESCAPE}[${code}m${text}${ESCAPE}[0m`;
const tasks: TaskView[] = [
	{ id: 1, subject: "不具合を再現する", status: "completed", description: "失敗するテストを足した" },
	{ id: 2, subject: "修正する", status: "in_progress", activeForm: "同期処理を修正中" },
	{ id: 3, subject: "PR を作る", status: "pending" },
];
const base = (id: string, start: string, end: string, first: string) =>
	report({ id, start: ms(start), end: ms(end), createdAt: ms(end), summary: { progress: [first], uncertainties: [], userActions: [] } }) as Report;
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

test("先頭に、進捗のバーと割合・完了数・経過、続けて今の作業を出す", () => {
	const lines = plain(renderPanel(input()));
	assert.equal(lines[0], "進捗 ███████░░░░░░░░░░░░░ 33%  1/3 完了 · 経過 45分");
	assert.equal(lines[1], "今   #2 修正する（同期処理を修正中）");
	assert.equal(plain(renderPanel(input({ tasks: [tasks[0], tasks[2]] })))[1], "次   #3 PR を作る");
	assert.equal(plain(renderPanel(input({ tasks: [tasks[0]] })))[0], "進捗 ████████████████████ 100%  1/1 完了 · 経過 45分");
});

test("タスクは状態の印と番号つきで並べ、完了には結果を添え、状態ごとに色を付ける", () => {
	const lines = renderPanel(input());
	assert.deepEqual(plain(lines).slice(2, 7), ["", "✓ #1 不具合を再現する", "    失敗するテストを足した", "◐ #2 修正する", "○ #3 PR を作る"]);
	assert.ok(lines[3].startsWith(colored(32, "✓")), "完了は緑");
	assert.ok(lines[5].startsWith(colored(36, "◐")), "進行中は水色");
	assert.equal(lines[6], colored(2, "○ #3 PR を作る"), "未着手は薄く");
});

test("タスクが多いときは終わっていないものを優先し、省いた件数を示す", () => {
	const many: TaskView[] = [
		...Array.from({ length: 4 }, (_, index) => ({ id: index + 1, subject: `済み${index + 1}`, status: "completed" as const })),
		...Array.from({ length: 3 }, (_, index) => ({ id: index + 5, subject: `残り${index + 5}`, status: "pending" as const })),
	];
	const lines = plain(renderPanel(input({ tasks: many, maxTasks: 4 })));
	assert.deepEqual(lines.slice(3, 8), ["✓ #4 済み4", "○ #5 残り5", "○ #6 残り6", "○ #7 残り7", "  ほか 3 件（完了 3）"]);
});

test("最新の基本のレポートは3つの欄を出し、それより前は新しい順に2件まで1行で出す", () => {
	const latest = report({ id: "d", start: ms("10:45"), end: ms("11:00"), toolCount: 7, summary: { progress: ["PR を作った", "CI は合格"], uncertainties: ["旧形式を移すか未定"], userActions: ["PR を確認する"] } }) as Report;
	const rollup = report({ id: "p", level: 1, start: ms("10:00"), end: ms("10:30"), children: ["a", "b"], summary: { progress: ["不具合を直した"], uncertainties: [], userActions: [] } }) as Report;
	const reports = [base("a", "10:00", "10:15", "原因を特定した"), base("b", "10:15", "10:30", "修正した"), rollup, base("c", "10:30", "10:45", "テストを足した"), latest];
	const lines = renderPanel(input({ tasks: [], reports }));
	assert.deepEqual(plain(lines), [
		"15分 10:45–11:00  ツール 7 回",
		"  ・PR を作った",
		"  ・CI は合格",
		"  未解決 旧形式を移すか未定",
		"  できること PR を確認する",
		"15分 10:30–10:45  テストを足した",
		"1時間 10:00–10:30  不具合を直した",
	]);
	assert.ok(lines[3].includes(colored(33, "未解決")), "未解決は黄");
	assert.ok(lines[4].includes(colored(36, "できること")), "できることは水色");
});

test("ページの場所が分かっていれば、末尾に添える", () => {
	const lines = plain(renderPanel(input({ pagePath: "/work/.pi/timeline/x.html" })));
	assert.deepEqual(lines.slice(-2), ["", "ページ /work/.pi/timeline/x.html"]);
});

test("タスクもレポートも無ければ、何も出さない", () => {
	assert.deepEqual(renderPanel(input({ tasks: [], reports: [], pagePath: "/work/x.html" })), []);
});

test("件名やレポートの文に制御文字が混ざっていても、色や画面を乱さないよう取り除く", () => {
	const hostile = `危険${ESCAPE}[31m赤${ESCAPE}[2J\u0007な件名`;
	const lines = renderPanel(input({ tasks: [{ id: 1, subject: hostile, status: "pending" }], reports: [base("a", "10:00", "10:15", hostile)] }));
	assert.equal(lines.join("\n").includes(`${ESCAPE}[31m`), false);
	assert.equal(lines.join("\n").includes(`${ESCAPE}[2J`), false);
	assert.ok(plain(lines).includes("○ #1 危険[31m赤[2Jな件名"));
});
