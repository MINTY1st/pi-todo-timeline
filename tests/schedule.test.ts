import { test } from "node:test";
import assert from "node:assert/strict";
import { isBaseDue, lastBaseEnd, rollupChildren } from "../src/schedule.ts";
import type { Report } from "../src/records.ts";
import { ms, report } from "./fixtures.ts";

const MINUTE = 60_000;
const base = (id: string, start: string, end: string) => report({ id, start: ms(start), end: ms(end), createdAt: ms(end) }) as Report;
const parent = (id: string, children: string[]) => report({ id, level: 1, children, start: ms("10:00"), end: ms("11:00"), createdAt: ms("11:00") }) as Report;

test("まだ報告していない最初の活動から間隔が経つと、基本のレポートの期限になる", () => {
	assert.equal(isBaseDue(ms("10:00"), ms("10:14"), 15 * MINUTE), false);
	assert.equal(isBaseDue(ms("10:00"), ms("10:15"), 15 * MINUTE), true);
});

test("報告していない活動が無ければ、どれだけ経っても期限にならない", () => {
	assert.equal(isBaseDue(null, ms("23:00"), 15 * MINUTE), false);
});

test("次の差分は、最後の基本のレポートが覆った時刻の後から始める", () => {
	assert.equal(lastBaseEnd([]), 0);
	assert.equal(lastBaseEnd([base("a", "10:00", "10:15"), parent("p", ["a"]), base("b", "10:15", "10:31")]), ms("10:31"));
});

test("束ねていない基本のレポートの最初の開始から期間が経つと、古い順にまとめて束ねる", () => {
	const reports = [base("b", "10:15", "10:30"), base("a", "10:00", "10:15"), base("c", "10:30", "10:45")];
	assert.deepEqual(rollupChildren(reports, ms("10:59"), 60 * MINUTE), []);
	assert.deepEqual(rollupChildren(reports, ms("11:00"), 60 * MINUTE).map((item) => item.id), ["a", "b", "c"]);
});

test("すでに束ねた基本のレポートと、束ねたレポート自身は対象にしない", () => {
	const reports = [base("a", "10:00", "10:15"), base("b", "10:15", "10:30"), parent("p", ["a", "b"]), base("c", "11:00", "11:15")];
	assert.deepEqual(rollupChildren(reports, ms("11:59"), 60 * MINUTE), []);
	assert.deepEqual(rollupChildren(reports, ms("12:00"), 60 * MINUTE).map((item) => item.id), ["c"]);
});
