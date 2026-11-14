import { test } from "node:test";
import assert from "node:assert/strict";
import { configPath, loadConfig, resolveConfig } from "../src/config.ts";

test("何も書かれていなければ既定値を使い、モデルは未設定のままにする", () => {
	const { config, problems } = resolveConfig({});
	assert.equal(config.enabled, true);
	assert.equal(config.provider, undefined);
	assert.equal(config.model, undefined);
	assert.equal(config.intervalMs, 15 * 60_000);
	assert.equal(config.rollupFactor, 4);
	assert.equal(config.maxInputChars, 40_000);
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
	assert.equal(configPath({ PI_TIMELINE_CONFIG: "/x/custom.json", XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }), "/x/custom.json");
	assert.equal(configPath({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" }), "/xdg/pi-timeline/config.json");
	assert.equal(configPath({ HOME: "/home/u" }), "/home/u/.config/pi-timeline/config.json");
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
