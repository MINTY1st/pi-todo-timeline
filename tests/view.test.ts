import { test } from "node:test";
import assert from "node:assert/strict";
import { REPORT_ENTRY_TYPE } from "../src/report/records.ts";
import type { Report } from "../src/report/records.ts";
import { periodLabel } from "../src/core/shared.ts";
import { taskLines, tasksFromBranch } from "../src/todo/tasks.ts";
import { renderTimeline } from "../src/view/format.ts";
import { custom, ms, report } from "./fixtures.ts";

const tasks = [
	{ id: 1, subject: "不具合を再現する", status: "completed", description: "失敗するテストを足した" },
	{ id: 2, subject: "修正する", status: "in_progress", activeForm: "同期処理を修正中" },
	{ id: 3, subject: "PR を作る", status: "pending" },
	{ id: 4, subject: "やめた作業", status: "deleted" },
];
const todoState = (clock: string, list: unknown) => custom(clock, "rpiv-todo-state", { action: "update", tasks: list, nextId: 5 });
const options = { now: ms("12:00"), timeZone: "UTC", levelLabels: ["15分", "1時間"], maxReports: 10, notes: [] };
const base = (id: string, start: string, end: string, first: string) =>
	report({ id, start: ms(start), end: ms(end), createdAt: ms(end), summary: { progress: [first], uncertainties: [], userActions: [] } }) as Report;

test("タスクは、最後に記録された状態から、消したものを除いて取り出す", () => {
	const entries = [todoState("10:00", [tasks[0]]), custom("10:01", REPORT_ENTRY_TYPE, report()), todoState("10:02", tasks)];
	assert.deepEqual(tasksFromBranch(entries).map((task) => task.id), [1, 2, 3]);
});

test("タスクの記録が無いか、形が違えば、タスクは無いものとして扱う", () => {
	assert.deepEqual(tasksFromBranch([]), []);
	assert.deepEqual(tasksFromBranch([todoState("10:00", "壊れた")]), []);
	assert.deepEqual(tasksFromBranch([todoState("10:00", [{ id: "1", subject: 3 }])]), []);
});

test("タスクは状態の印と番号つきで並べ、完了には結果を、進行中には今の作業を添える", () => {
	assert.deepEqual(taskLines(tasksFromBranch([todoState("10:00", tasks)])), [
		"✓ #1 不具合を再現する",
		"    失敗するテストを足した",
		"◐ #2 修正する（同期処理を修正中）",
		"○ #3 PR を作る",
	]);
});

test("間隔は、割り切れれば時間で、そうでなければ分で表す", () => {
	assert.equal(periodLabel(15 * 60_000), "15分");
	assert.equal(periodLabel(60 * 60_000), "1時間");
	assert.equal(periodLabel(90 * 60_000), "90分");
});

test("完了数つきのタスクと、最新の基本のレポートの3欄、残りのレポートを新しい順に1行ずつ出す", () => {
	const latest = report({ id: "c", start: ms("10:30"), end: ms("10:45"), createdAt: ms("10:45"), toolCount: 7, summary: { progress: ["PR を作った", "CI は合格"], uncertainties: ["旧形式を移すか未定"], userActions: ["PR を確認する"] } }) as Report;
	const rollup = report({ id: "p", level: 1, start: ms("10:00"), end: ms("10:30"), createdAt: ms("11:00"), children: ["a", "b"], summary: { progress: ["不具合を直した"], uncertainties: [], userActions: [] } }) as Report;
	const reports = [base("a", "10:00", "10:15", "原因を特定した"), base("b", "10:15", "10:30", "修正した"), rollup, latest];
	assert.equal(renderTimeline({ tasks: tasksFromBranch([todoState("10:00", tasks)]), reports, ...options }), [
		"タイムライン",
		"タスク 1/3 完了",
		"  ✓ #1 不具合を再現する",
		"      失敗するテストを足した",
		"  ◐ #2 修正する（同期処理を修正中）",
		"  ○ #3 PR を作る",
		"",
		"レポート",
		"  15分 10:30–10:45（ツール 7 回）",
		"    ・PR を作った",
		"    ・CI は合格",
		"    未解決: 旧形式を移すか未定",
		"    できること: PR を確認する",
		"  1時間 10:00–10:30  不具合を直した",
		"  15分 10:15–10:30  修正した",
		"  15分 10:00–10:15  原因を特定した",
	].join("\n"));
});

test("タスクもレポートも無ければ、その旨と添え書きだけを出す", () => {
	assert.equal(renderTimeline({ tasks: [], reports: [], ...options, notes: ["レポートのモデルが未設定です"] }), [
		"タイムライン",
		"レポートはまだありません",
		"",
		"レポートのモデルが未設定です",
	].join("\n"));
});

test("今日でない日のレポートには月日を付け、上限を超えた分は件数だけ示す", () => {
	const reports = [base("a", "10:00", "10:15", "1件目"), base("b", "10:15", "10:30", "2件目"), base("c", "10:30", "10:45", "3件目")];
	const text = renderTimeline({ tasks: [], reports, ...options, now: ms("12:00") + 24 * 3_600_000, maxReports: 2 });
	assert.deepEqual(text.split("\n").slice(1), [
		"レポート",
		"  15分 11/01 10:30–10:45（ツール 3 回）",
		"    ・3件目",
		"  15分 11/01 10:15–10:30  2件目",
		"  ほか 1 件",
	]);
});
