import { test } from "node:test";
import assert from "node:assert/strict";
import { collectDelta } from "../src/delta.ts";
import { REPORT_ENTRY_TYPE } from "../src/records.ts";
import { assistant, custom, ms, report, text, thinking, toolCall, toolResult, user } from "./fixtures.ts";

const limits = { maxChars: 10_000, maxItemChars: 200 };
const session = () => [
	user("10:00", "同期の不具合を直して"),
	assistant("10:01", [thinking("まずテストを見る"), text("テストを実行します"), toolCall("bash", { command: "npm test" })]),
	toolResult("10:02", "bash", "51 passed"),
	assistant("10:03", [text("直しました")]),
];

test("発言・ツールの呼び出し・ツールの結果を1件1行にし、思考は含めない", () => {
	const delta = collectDelta(session(), 0, limits);
	assert.deepEqual(delta.text.split("\n"), [
		"[10:00] ユーザー: 同期の不具合を直して",
		"[10:01] アシスタント: テストを実行します",
		"[10:01] ツールの呼び出し bash: {\"command\":\"npm test\"}",
		"[10:02] ツールの結果 bash: 51 passed",
		"[10:03] アシスタント: 直しました",
	]);
	assert.equal(delta.toolCount, 1);
	assert.equal(delta.start, ms("10:00"));
	assert.equal(delta.end, ms("10:03"));
	assert.equal(delta.truncated, false);
});

test("指定した時刻までのエントリは含めず、その時刻ちょうども含めない", () => {
	const delta = collectDelta(session(), ms("10:02"), limits);
	assert.deepEqual(delta.text.split("\n"), ["[10:03] アシスタント: 直しました"]);
	assert.equal(delta.start, ms("10:03"));
	assert.equal(delta.toolCount, 0);
});

test("対象が無ければ空で返す", () => {
	const delta = collectDelta(session(), ms("10:03"), limits);
	assert.deepEqual(delta, { text: "", start: null, end: null, toolCount: 0, truncated: false });
});

test("失敗したツールの結果は失敗と示す", () => {
	const delta = collectDelta([toolResult("10:02", "bash", "exit 1", true)], 0, limits);
	assert.equal(delta.text, "[10:02] ツールの結果 bash（失敗）: exit 1");
});

test("長い項目は上限で切り、改行は空白にする", () => {
	const delta = collectDelta([user("10:00", "あ".repeat(300) + "\n次の行")], 0, { maxChars: 10_000, maxItemChars: 20 });
	assert.equal(delta.text, "[10:00] ユーザー: " + "あ".repeat(20) + "…");
	const multiline = collectDelta([user("10:00", "1行目\n2行目")], 0, limits);
	assert.equal(multiline.text, "[10:00] ユーザー: 1行目 2行目");
});

test("全体が上限を超えるときは入る分だけ入れ、残りは次回に持ち越す", () => {
	const entries = [user("10:00", "あ".repeat(30)), user("10:05", "い".repeat(30)), user("10:10", "う".repeat(30))];
	const delta = collectDelta(entries, 0, { maxChars: 100, maxItemChars: 200 });
	assert.equal(delta.text.split("\n").length, 2);
	assert.equal(delta.end, ms("10:05"), "次回は 10:05 より後から始める");
	assert.equal(delta.truncated, true);
});

test("同じ時刻のエントリは、上限を超えても分けない（次回に取りこぼさないため）", () => {
	const entries = [user("10:00", "あ".repeat(30)), user("10:05", "い".repeat(30)), user("10:05", "う".repeat(30)), user("10:10", "え".repeat(30))];
	const delta = collectDelta(entries, 0, { maxChars: 100, maxItemChars: 200 });
	assert.equal(delta.text.split("\n").length, 3);
	assert.equal(delta.end, ms("10:05"));
	assert.equal(delta.truncated, true);
});

test("最初の1件が上限を超えていても、1件は必ず入れる", () => {
	const delta = collectDelta([user("10:00", "あ".repeat(150))], 0, { maxChars: 50, maxItemChars: 200 });
	assert.equal(delta.end, ms("10:00"));
	assert.equal(delta.truncated, false);
});

test("拡張の状態の記録は含めず、文脈に入るカスタムメッセージは含める", () => {
	const entries = [
		custom("10:00", REPORT_ENTRY_TYPE, report()),
		custom("10:01", "rpiv-todo-state", { tasks: [] }),
		{ id: "m1", parentId: null, timestamp: "2030-11-01T10:02:00.000Z", type: "custom_message", customType: "devflow", content: "実装に進みました", display: true },
	];
	const delta = collectDelta(entries, 0, limits);
	assert.equal(delta.text, "[10:02] 通知 devflow: 実装に進みました");
});
