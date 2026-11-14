import { test } from "node:test";
import assert from "node:assert/strict";
import { isReport, REPORT_ENTRY_TYPE, reportsFromBranch } from "../src/records.ts";
import { custom, report, user } from "./fixtures.ts";

test("レポートの形を満たすデータだけをレポートと認める", () => {
	assert.equal(isReport(report()), true);
	assert.equal(isReport({ ...report(), summary: { progress: [], uncertainties: [], userActions: [] } }), false, "進捗が0件");
	assert.equal(isReport({ ...report(), level: "0" }), false, "段が数でない");
	assert.equal(isReport({ ...report(), children: [1] }), false, "子の ID が文字列でない");
	assert.equal(isReport({ ...report(), version: 2 }), false, "知らない版");
	assert.equal(isReport(null), false);
});

test("ブランチから自分のレポートだけを、記録された順に取り出す", () => {
	const entries = [
		user("10:00", "作って"),
		custom("10:15", REPORT_ENTRY_TYPE, report({ id: "r1" })),
		custom("10:16", "rpiv-todo-state", { tasks: [] }),
		custom("10:20", REPORT_ENTRY_TYPE, { version: 1, id: "壊れた記録" }),
		custom("10:30", REPORT_ENTRY_TYPE, report({ id: "r2", start: ms30(), end: ms30() + 1 })),
	];
	assert.deepEqual(reportsFromBranch(entries).map((item) => item.id), ["r1", "r2"]);
});

const ms30 = (): number => Date.parse("2030-11-01T10:15:00.000Z");
