import { test } from "node:test";
import assert from "node:assert/strict";
import { configPath, loadConfig, resolveConfig } from "../src/config.ts";
import { native } from "./fixtures.ts";

test("何も書かれていなければ既定値を使い、モデルは未設定のままにする", () => {
	const { config, problems } = resolveConfig({});
	assert.equal(config.enabled, true);
	assert.equal(config.provider, undefined);
	assert.equal(config.model, undefined);
	assert.equal(config.intervalMs, 15 * 60_000);
	assert.equal(config.rollupFactor, 4);
	assert.equal(config.maxInputChars, 40_000);
	assert.equal(config.maxOutputTokens, 4000, "思考の分も数えるモデルがあるので、要約の長さより多めにする");
	assert.equal(config.language, "日本語");
	assert.equal(config.maxLineChars, 160);
	assert.equal(config.notify, true);
	assert.deepEqual(problems, []);
});

test("書かれた値を使い、分と秒の指定はミリ秒に直す", () => {
	const { config, problems } = resolveConfig({ provider: "p", model: "m", intervalMinutes: 30, rollupFactor: 2, timeoutSeconds: 60, notify: false, enabled: false, language: "English", maxLineChars: 320 });
	assert.deepEqual([config.provider, config.model], ["p", "m"]);
	assert.equal(config.intervalMs, 30 * 60_000);
	assert.equal(config.rollupFactor, 2);
	assert.equal(config.timeoutMs, 60_000);
	assert.deepEqual([config.notify, config.enabled, config.language, config.maxLineChars], [false, false, "English", 320]);
	assert.deepEqual(problems, []);
});

test("ページは既定で書き出し、置き場は .pi/timeline。切ることも、置き場を変えることもできる", () => {
	const defaults = resolveConfig({}).config;
	assert.deepEqual([defaults.page, defaults.pageDirectory], [true, ".pi/timeline"]);
	const custom = resolveConfig({ page: false, pageDirectory: "/shared/pages" }).config;
	assert.deepEqual([custom.page, custom.pageDirectory], [false, "/shared/pages"]);
});

test("パネルは既定で出し、並べるタスクは10件まで。切ることも、件数を変えることもできる", () => {
	const defaults = resolveConfig({}).config;
	assert.deepEqual([defaults.panel, defaults.panelMaxTasks], [true, 10]);
	const custom = resolveConfig({ panel: false, panelMaxTasks: 5 }).config;
	assert.deepEqual([custom.panel, custom.panelMaxTasks], [false, 5]);
});

test("パネルの高さの上限は画面の半分。10〜90% の範囲で変えられる", () => {
	assert.equal(resolveConfig({}).config.panelMaxHeightPercent, 50);
	assert.equal(resolveConfig({ panelMaxHeightPercent: 70 }).config.panelMaxHeightPercent, 70);
	const tooTall = resolveConfig({ panelMaxHeightPercent: 100 });
	assert.equal(tooTall.config.panelMaxHeightPercent, 50);
	assert.match(tooTall.problems[0], /^panelMaxHeightPercent は 10〜90/);
});

test("todo ツールは既定で登録し、切ることもできる", () => {
	assert.equal(resolveConfig({}).config.todoTool, true);
	assert.equal(resolveConfig({ todoTool: false }).config.todoTool, false);
});

test("小窓は既定で使い、切ることもできる", () => {
	assert.equal(resolveConfig({}).config.webPopup, true);
	assert.equal(resolveConfig({ webPopup: false }).config.webPopup, false);
});

test("思考の強さは書かれていればそのまま使い、無ければ指定しない", () => {
	assert.equal(resolveConfig({}).config.reasoning, undefined);
	assert.equal(resolveConfig({ reasoning: "low" }).config.reasoning, "low");
});

test("範囲の外の値や型の違う値は既定値に戻し、どの項目かを知らせる", () => {
	const { config, problems } = resolveConfig({ intervalMinutes: 0, rollupFactor: "4", maxInputChars: 10, provider: "", notify: "yes" });
	assert.equal(config.intervalMs, 15 * 60_000);
	assert.equal(config.rollupFactor, 4);
	assert.equal(config.maxInputChars, 40_000);
	assert.equal(config.provider, undefined);
	assert.equal(config.notify, true);
	assert.deepEqual(problems.map((problem) => problem.split(" ")[0]), ["provider", "intervalMinutes", "rollupFactor", "maxInputChars", "notify"]);
});

test("設定がオブジェクトでなければ、既定値を使って知らせる", () => {
	const { config, problems } = resolveConfig([1, 2]);
	assert.equal(config.intervalMs, 15 * 60_000);
	assert.equal(problems.length, 1);
});

test("設定ファイルの場所は、専用の環境変数、XDG_CONFIG_HOME、ホームの順に決める", () => {
	assert.equal(configPath({ PI_TODO_TIMELINE_CONFIG: "/x/custom.json", XDG_CONFIG_HOME: "/xdg" }, "/home/u"), "/x/custom.json");
	assert.equal(configPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/u"), native("/xdg/pi-todo-timeline/config.json"));
	assert.equal(configPath({}, "/home/u"), native("/home/u/.config/pi-todo-timeline/config.json"));
});

test("ホームは、環境変数 HOME ではなく渡されたディレクトリを使う（Windows には HOME が無い）。空の環境変数は無いものとして扱う", () => {
	assert.equal(configPath({ HOME: "/ignored" }, "/users/u"), native("/users/u/.config/pi-todo-timeline/config.json"));
	assert.equal(configPath({ PI_TODO_TIMELINE_CONFIG: "", XDG_CONFIG_HOME: "" }, "/users/u"), native("/users/u/.config/pi-todo-timeline/config.json"));
});

test("設定ファイルが無ければ既定値、壊れていれば既定値を使って知らせる", () => {
	const missing = loadConfig("/none.json", () => { throw Object.assign(new Error("no file"), { code: "ENOENT" }); });
	assert.deepEqual(missing.problems, []);
	const broken = loadConfig("/broken.json", () => "{壊れた");
	assert.equal(broken.config.intervalMs, 15 * 60_000);
	assert.match(broken.problems[0], /broken\.json/);
	const loaded = loadConfig("/ok.json", () => JSON.stringify({ provider: "p", model: "m" }));
	assert.equal(loaded.config.model, "m");
});
