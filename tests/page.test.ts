import { test } from "node:test";
import assert from "node:assert/strict";
import { activitySpan, excludeFromGit, pagePath, publishPage } from "../src/page.ts";
import { custom, fakeFiles, ms, session } from "./fixtures.ts";

const location = { cwd: "/work/app", directory: ".pi/timeline", sessionId: "01a1d8af-9c88-723c-8893-0ad7d50d7bea", startedAt: ms("10:00"), timeZone: "UTC" };

test("ページは、作業ディレクトリの下に、セッションの開始日時と ID の先頭を名前にして置く", () => {
	assert.equal(pagePath(location), "/work/app/.pi/timeline/1101-1000-01a1d8af.html");
	assert.equal(pagePath({ ...location, directory: "/shared/pages" }), "/shared/pages/1101-1000-01a1d8af.html");
	assert.equal(pagePath({ ...location, startedAt: null }), "/work/app/.pi/timeline/01a1d8af.html");
});

test("ID にパスの記号が混ざっていても、置き場の外には出ない", () => {
	assert.equal(pagePath({ ...location, sessionId: "../../etc/x" }), "/work/app/.pi/timeline/1101-1000-etcx.html");
	assert.equal(pagePath({ ...location, sessionId: "" }), "/work/app/.pi/timeline/1101-1000-session.html");
});

test("中身が変わったときだけ書き、同じなら書かない", () => {
	const files = fakeFiles();
	assert.equal(publishPage(files, "/p.html", "<a>"), true);
	assert.equal(publishPage(files, "/p.html", "<a>"), false);
	assert.equal(publishPage(files, "/p.html", "<b>"), true);
	assert.deepEqual(files.writes, ["/p.html", "/p.html"]);
	assert.equal(files.stored.get("/p.html"), "<b>");
});

test("git の作業ツリーなら、ページの置き場を追跡の対象から外す行を1回だけ足す", () => {
	const files = fakeFiles({ "/work/app/.git/info/exclude": "# 手で書いた行\n*.log" });
	assert.equal(excludeFromGit(files, "/work/app", ".pi/timeline"), true);
	assert.equal(files.stored.get("/work/app/.git/info/exclude"), "# 手で書いた行\n*.log\n/.pi/timeline/\n");
	assert.equal(excludeFromGit(files, "/work/app", ".pi/timeline"), false);
	assert.equal(files.writes.length, 1);
});

test("git の作業ツリーでないか、置き場が作業ディレクトリの外なら、何も書かない", () => {
	const plain = fakeFiles();
	assert.equal(excludeFromGit(plain, "/work/app", ".pi/timeline"), false);
	const outside = fakeFiles({ "/work/app/.git/info/exclude": "" });
	assert.equal(excludeFromGit(outside, "/work/app", "/shared/pages"), false);
	assert.equal(excludeFromGit(outside, "/work/app", "../pages"), false);
	assert.deepEqual([...plain.writes, ...outside.writes], []);
});

test("置き場が絶対パスでも、作業ディレクトリの中なら外す行を足す", () => {
	const files = fakeFiles({ "/work/app/.git/info/exclude": "" });
	assert.equal(excludeFromGit(files, "/work/app", "/work/app/out/pages"), true);
	assert.equal(files.stored.get("/work/app/.git/info/exclude"), "/out/pages/\n");
});

test("活動の範囲は、発言やツールの結果の最初と最後の時刻。拡張の記録は数えない", () => {
	assert.deepEqual(activitySpan([...session(), custom("11:00", "rpiv-todo-state", {})]), { first: ms("10:00"), last: ms("10:03") });
	assert.deepEqual(activitySpan([]), { first: null, last: null });
});
