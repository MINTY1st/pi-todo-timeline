import { test } from "node:test";
import assert from "node:assert/strict";
import { applyToDirectory, buildRule, patchCss } from "../src/web-css.ts";
import { fakeFiles } from "./fixtures.ts";

const START = "/* pi-todo-timeline:start */";
const END = "/* pi-todo-timeline:end */";
const RULE_50 = ".extension-widget-panels{max-height:50dvh!important}";
const ORIGINAL = ".a{color:red}.extension-widget-panels{max-height:min(144px,18dvh)}";
const block = (rule: string) => `\n${START}${rule}${END}\n`;

test("上書きの規則は、パネルの高さの上限を画面の高さに対する割合で決める", () => {
	assert.equal(buildRule(50), RULE_50);
	assert.equal(buildRule(80), ".extension-widget-panels{max-height:80dvh!important}");
});

test("目印が無ければ、元の中身を変えずに、末尾に目印つきで足す", () => {
	assert.equal(patchCss(ORIGINAL, RULE_50), ORIGINAL + block(RULE_50));
});

test("すでに同じ規則が入っていれば、書き換えない", () => {
	assert.equal(patchCss(ORIGINAL + block(RULE_50), RULE_50), null);
});

test("値が変わったら、目印の間だけを置き換える", () => {
	assert.equal(patchCss(ORIGINAL + block(RULE_50), buildRule(70)), ORIGINAL + block(buildRule(70)));
});

test("外すときは、足した分だけを取り除いて元の中身に戻す。足していなければ何もしない", () => {
	assert.equal(patchCss(ORIGINAL + block(RULE_50), undefined), ORIGINAL);
	assert.equal(patchCss(ORIGINAL, undefined), null);
});

test("終わりの目印が欠けていても、始まりの目印から後ろを自分の分として置き換える", () => {
	assert.equal(patchCss(`${ORIGINAL}\n${START}.broken{`, RULE_50), ORIGINAL + block(RULE_50));
});

test("パネルの規則を含む CSS にだけ足し、ほかの CSS には触らない", () => {
	const files = fakeFiles({ "/web/css/a.css": ORIGINAL, "/web/css/b.css": ".b{color:blue}", "/web/css/note.txt": ".extension-widget-panels{}" });
	const outcome = applyToDirectory(files, "/web/css", RULE_50);
	assert.deepEqual([outcome.ok, outcome.changed, outcome.unchanged], [true, ["a.css"], []]);
	assert.equal(files.stored.get("/web/css/a.css"), ORIGINAL + block(RULE_50));
	assert.equal(files.stored.get("/web/css/b.css"), ".b{color:blue}");
	assert.deepEqual(files.writes, ["/web/css/a.css"]);
});

test("2回目は何も書かず、外すと元の中身に戻る", () => {
	const files = fakeFiles({ "/web/css/a.css": ORIGINAL });
	applyToDirectory(files, "/web/css", RULE_50);
	const again = applyToDirectory(files, "/web/css", RULE_50);
	assert.deepEqual([again.ok, again.changed, again.unchanged], [true, [], ["a.css"]]);
	assert.equal(files.writes.length, 1);
	const removed = applyToDirectory(files, "/web/css", undefined);
	assert.deepEqual(removed.changed, ["a.css"]);
	assert.equal(files.stored.get("/web/css/a.css"), ORIGINAL);
});

test("CSS の置き場が無いか、パネルの規則を含む CSS が無ければ、失敗として理由を返す", () => {
	const missing = applyToDirectory(fakeFiles(), "/web/css", RULE_50);
	assert.equal(missing.ok, false);
	assert.match(missing.message, /\/web\/css が見つかりません/);
	const unrelated = applyToDirectory(fakeFiles({ "/web/css/b.css": ".b{}" }), "/web/css", RULE_50);
	assert.equal(unrelated.ok, false);
	assert.match(unrelated.message, /\.extension-widget-panels を含む CSS がありません/);
});
