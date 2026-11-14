import { test } from "node:test";
import assert from "node:assert/strict";
import { apiPath, buildPopupScript, isLayoutChunk, pageNameFor, sessionIdFrom, tabForClick, withPageOptions } from "../src/web-popup.ts";
import { applyPatch } from "../src/web-patch.ts";
import { fakeFiles, native } from "./fixtures.ts";

const SESSION = "01a1d8af-9c88-723c-8893-0ad7d50d7bea";
const CHUNK = "(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[7177],{}]);";
/** ボタンの中を押したときの、偽の出来事 */
const clickOn = (key: string | undefined, shiftKey = false) => ({
	shiftKey,
	target: { closest: (selector: string) => (key !== undefined && selector === ".extension-widget-trigger" ? { querySelector: () => ({ textContent: ` ${key} ` }) } : null) },
});

test("画面の URL から、今のセッションの ID を取り出す", () => {
	assert.equal(sessionIdFrom(`?session=${SESSION}&x=1`), SESSION);
	assert.equal(sessionIdFrom(""), "");
});

test("ファイルのパスを Pi Web の API の形にする。区切りごとに符号化し、Windows の区切りも直す", () => {
	assert.equal(apiPath("/home/u/my work/.pi/timeline/a b.html"), "home/u/my%20work/.pi/timeline/a%20b.html");
	assert.equal(apiPath("C:\\Users\\u\\.pi\\timeline\\x.html"), "C%3A/Users/u/.pi/timeline/x.html");
});

test("置き場のファイルの中から、今のセッションのページを選ぶ", () => {
	const names = ["1114-1512-01a1d8af.html", "1114-1750-01a1d940.html", "note.txt", "01a1d8af.html.bak"];
	assert.equal(pageNameFor(SESSION, names), "1114-1512-01a1d8af.html");
	assert.equal(pageNameFor(SESSION, ["01a1d8af.html"]), "01a1d8af.html", "開始の日時が付かない名前");
	assert.equal(pageNameFor(SESSION, ["1114-1512-01a1d8af.html", "1115-0900-01a1d8af.html"]), "1115-0900-01a1d8af.html", "複数あれば新しいほう");
	assert.equal(pageNameFor(SESSION, ["1114-1750-01a1d940.html"]), undefined);
	assert.equal(pageNameFor("", names), undefined);
});

test("timeline と reports のボタンの押下だけを小窓に回す。Shift を押しながらのときと、ほかのボタンは回さない", () => {
	assert.equal(tabForClick(clickOn("timeline")), "tasks");
	assert.equal(tabForClick(clickOn("reports")), "reports");
	assert.equal(tabForClick(clickOn("other-extension")), undefined);
	assert.equal(tabForClick(clickOn("timeline", true)), undefined, "Shift つきは、元の文字のパネルを開く");
	assert.equal(tabForClick(clickOn(undefined)), undefined, "ボタンの外");
	assert.equal(tabForClick({ shiftKey: false, target: null }), undefined);
});

test("差し込むスクリプトは単独で構文として成り立ち、失敗しても画面を壊さない形にしてある", () => {
	const script = buildPopupScript();
	assert.doesNotThrow(() => new Function("window", script));
	assert.ok(script.startsWith(";(function () {\ntry {"));
	assert.ok(script.trimEnd().endsWith("})();"));
	assert.match(script, /\} catch \(/);
	for (const name of ["sessionIdFrom", "apiPath", "pageNameFor", "tabForClick", "withPageOptions", "installPopup"]) assert.ok(script.includes(`var ${name} = function`), name);
	assert.doesNotMatch(script, /https?:\/\//, "外の資源を読み込まない");
});

const PAGE = '<!DOCTYPE html><html lang="ja"><head></head><body></body></html>';
const opened = (attributes: string) => `<!DOCTYPE html><html lang="ja"${attributes}><head></head><body></body></html>`;

test("ページに、開く面と、Pi Web の今の配色の色を入れる。色はページの変数を上書きする形で渡す", () => {
	const colors = { "--bg": "#19201f", "--panel": "#212b28", "--accent": "#acccb7" };
	assert.equal(withPageOptions(PAGE, { tab: "reports", scheme: "dark", colors }), opened(' data-tab="reports" data-theme="dark" style="--bg:#19201f;--panel:#212b28;--accent:#acccb7;color-scheme:dark"'));
	assert.equal(withPageOptions(PAGE, { tab: "tasks", scheme: "light", colors: { "--bg": " #faf6ee " } }), opened(' data-tab="tasks" data-theme="light" style="--bg:#faf6ee;color-scheme:light"'));
});

test("配色が分からなければ色は入れず、開く面だけを入れる。指定を入れる場所が無い HTML はそのまま返す", () => {
	assert.equal(withPageOptions(PAGE, { tab: "tasks", scheme: "", colors: {} }), opened(' data-tab="tasks"'));
	assert.equal(withPageOptions("<html><body></body></html>", { tab: "reports", scheme: "dark", colors: { "--bg": "#000" } }), "<html><body></body></html>");
});

test("色として読めない値や、属性の外に出られる値は捨てる。開く面は決まった2つだけを受け取る", () => {
	const colors = { "--bg": 'red" onload="x', "--text": "#fff;background:url(x)", "--panel": "url(x)", "bad name": "#000", "--line": "rgb(1, 2, 3)", "--muted": "" };
	assert.equal(withPageOptions(PAGE, { tab: 'x" onload="y', scheme: 'dark" x="', colors }), opened(' data-tab="tasks" style="--line:rgb(1, 2, 3)"'));
});

test("スクリプトを動かすと、押下の見張りだけを始める。キーは見張らない（Pi Web では Esc が実行の中断なので、巻き込まないため）", () => {
	const listened: Array<[string, boolean]> = [];
	const view = { document: { addEventListener: (type: string, _handler: unknown, capture: boolean) => void listened.push([type, capture]) }, location: { search: "" } };
	new Function("window", buildPopupScript())(view);
	assert.deepEqual(listened, [["click", true]]);
	assert.doesNotMatch(buildPopupScript(), /keydown|Escape/);
	assert.doesNotThrow(() => new Function("window", buildPopupScript())({}));
});

test("スクリプトを足す先は、Pi Web の画面の共通部分のチャンクだけ", () => {
	assert.equal(isLayoutChunk("layout-a5a35c21314fb979.js", CHUNK), true);
	assert.equal(isLayoutChunk("page-06478a07fffa59ef.js", CHUNK), false);
	assert.equal(isLayoutChunk("layout-a5a35c21314fb979.js", "console.log(1)"), false, "中身がチャンクの形でない");
	assert.equal(isLayoutChunk("layout-a5a35c21314fb979.js.map", CHUNK), false);
});

test("スクリプトは共通部分のチャンクにだけ足し、2回目は書かず、外すと元の中身に戻る", () => {
	const files = fakeFiles({ "/web/app/layout-abc.js": CHUNK, "/web/app/page-abc.js": CHUNK });
	const script = buildPopupScript();
	const applied = applyPatch(files, "/web/app", isLayoutChunk, script, "足す先がありません");
	assert.deepEqual([applied.ok, applied.changed], [true, ["layout-abc.js"]]);
	assert.ok((files.at("/web/app/layout-abc.js") ?? "").startsWith(CHUNK));
	assert.doesNotThrow(() => new Function("self", "window", files.at("/web/app/layout-abc.js") ?? ""), "足した後もチャンクとして成り立つ");
	assert.deepEqual(applyPatch(files, "/web/app", isLayoutChunk, script, "足す先がありません").changed, []);
	applyPatch(files, "/web/app", isLayoutChunk, undefined, "足す先がありません");
	assert.equal(files.at("/web/app/layout-abc.js"), CHUNK);
	assert.deepEqual(files.writes, [native("/web/app/layout-abc.js"), native("/web/app/layout-abc.js")]);
	const missing = applyPatch(fakeFiles({ "/web/app/page-abc.js": CHUNK }), "/web/app", isLayoutChunk, script, "足す先がありません");
	assert.deepEqual([missing.ok, missing.message], [false, "足す先がありません"]);
});
