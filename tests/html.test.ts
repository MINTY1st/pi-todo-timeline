import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage } from "../src/html.ts";
import type { Report } from "../src/records.ts";
import { baseReport, ms, report, sampleTasks } from "./fixtures.ts";

const tasks = sampleTasks;
const base = baseReport;
const input = (overrides: Record<string, unknown> = {}) => ({
	title: "同期の不具合",
	tasks,
	reports: [] as Report[],
	firstActivity: ms("10:00"),
	lastActivity: ms("10:45"),
	now: ms("12:00"),
	timeZone: "UTC",
	levelLabels: ["15分", "1時間"],
	...overrides,
});
const before = (page: string, first: string, second: string) => {
	assert.ok(page.includes(first), `${first} が無い`);
	assert.ok(page.includes(second), `${second} が無い`);
	return page.indexOf(first) < page.indexOf(second);
};

test("進捗は、完了した件数の割合を数字とバーの幅で示し、件数と経過した時間を添える", () => {
	const page = renderPage(input());
	assert.match(page, /<div class="percent">33<small>%<\/small><\/div>/);
	assert.match(page, /<i class="done" style="width:33%"><\/i>/);
	assert.match(page, /3 件中 1 件が完了/);
	assert.match(page, /経過 45分/);
	assert.match(page, /<span class="badge active">進行中<\/span>/);
	assert.match(page, /タスク<span class="count">1\/3<\/span>/);
	assert.match(renderPage(input({ lastActivity: ms("11:05") })), /経過 1時間 5分/);
});

test("進行中のタスクがあれば「今」として、無ければ最初の未着手を「次」として示す", () => {
	assert.match(renderPage(input()), /今: <b>#2 修正する<\/b>（同期処理を修正中）/);
	const waiting = renderPage(input({ tasks: [tasks[0], tasks[2]] }));
	assert.match(waiting, /次: <b>#3 PR を作る<\/b>/);
	const finished = renderPage(input({ tasks: [tasks[0]] }));
	assert.match(finished, /<span class="badge done">完了<\/span>/);
	assert.doesNotMatch(finished, /今: |次: /);
	assert.match(renderPage(input({ tasks: [tasks[2]] })), /<span class="badge idle">未着手<\/span>/);
});

test("タスクは状態ごとの印を付け、完了には結果を、進行中には今の作業を添える", () => {
	const page = renderPage(input());
	assert.match(page, /<li class="completed"><span class="mark">✓<\/span><span class="title">不具合を再現する<\/span><div class="result"><span class="tag">完了<\/span>失敗するテストを足した<\/div><\/li>/);
	assert.match(page, /<li class="in_progress"><span class="mark">◐<\/span><span class="title">修正する<\/span><div class="result"><span class="tag">進行中<\/span>同期処理を修正中<\/div><\/li>/);
	assert.match(page, /<li class="pending"><span class="mark">○<\/span><span class="title">PR を作る<\/span><\/li>/);
});

test("レポートは新しい順に並べ、時刻・段・ツールの回数・3つの欄を出す", () => {
	const latest = report({ id: "c", start: ms("10:30"), end: ms("10:45"), toolCount: 7, summary: { progress: ["PR を作った", "CI は合格"], uncertainties: ["旧形式を移すか未定"], userActions: ["PR を確認する"] } }) as Report;
	const page = renderPage(input({ reports: [base("a", "10:00", "10:15", "原因を特定した"), latest] }));
	assert.equal(before(page, "PR を作った", "原因を特定した"), true);
	assert.match(page, /<span class="time">10:30–10:45<\/span><span class="level">15分<\/span><span>ツール 7 回<\/span>/);
	assert.match(page, /<div class="lead">PR を作った<\/div><ul><li>CI は合格<\/li><\/ul>/);
	assert.match(page, /<dt class="open">未解決<\/dt><dd>旧形式を移すか未定<\/dd><dt class="todo">できること<\/dt><dd>PR を確認する<\/dd>/);
	assert.match(page, /レポート<span class="count">2<\/span>/);
});

test("束ねたレポートは、含む基本のレポートを中に折りたたみ、それらを外には並べない", () => {
	const rollup = report({ id: "p", level: 1, start: ms("10:00"), end: ms("10:30"), createdAt: ms("11:00"), toolCount: 5, children: ["a", "b"], summary: { progress: ["不具合を直した"], uncertainties: [], userActions: [] } }) as Report;
	const page = renderPage(input({ reports: [base("a", "10:00", "10:15", "原因を特定した"), base("b", "10:15", "10:30", "修正した"), rollup, base("c", "10:30", "10:45", "PR を作った")] }));
	assert.match(page, /<article class="report rollup">/);
	assert.match(page, /<summary>含まれる 15分のレポート 2 件<\/summary><ul><li>10:15–10:30 修正した<\/li><li>10:00–10:15 原因を特定した<\/li><\/ul>/);
	assert.equal(page.match(/<article class="report/g)?.length, 2, "外に並ぶのは、束ねたレポートと、まだ束ねていない1件");
	assert.equal(before(page, "PR を作った", "不具合を直した"), true);
});

test("タスク名やレポートの文に HTML の記号があっても、文字として表示する", () => {
	const hostile = "<script>alert(1)</script> & \"引用\"";
	const page = renderPage(input({ title: hostile, tasks: [{ id: 1, subject: hostile, status: "completed", description: hostile }], reports: [base("a", "10:00", "10:15", hostile)] }));
	assert.doesNotMatch(page, /<script>alert/);
	assert.equal(page.split("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;引用&quot;").length - 1, 4);
});

test("タスクやレポートが無ければその旨を出し、題名が無ければ題名の行を省く", () => {
	const page = renderPage(input({ title: undefined, tasks: [], firstActivity: null, lastActivity: null }));
	assert.match(page, /タスクはまだありません/);
	assert.match(page, /レポートはまだありません/);
	assert.doesNotMatch(page, /class="sub"|class="percent"|記録の最後/);
});

test("今日でない日のレポートには月日を付け、記録の最後の時刻を末尾に出す", () => {
	const page = renderPage(input({ reports: [base("a", "10:00", "10:15", "原因を特定した")], now: ms("12:00") + 24 * 3_600_000 }));
	assert.match(page, /<span class="time">11\/01 10:00–10:15<\/span>/);
	assert.match(page, /記録の最後 11\/01 10:45/);
	assert.match(renderPage(input()), /記録の最後 10:45/);
});

test("1枚で完結した HTML として出す", () => {
	const page = renderPage(input());
	assert.match(page, /^<!DOCTYPE html>/);
	assert.match(page, /<meta charset="UTF-8">/);
	assert.doesNotMatch(page, /https?:\/\//, "外の資源を読み込まない");
});
