import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/pi-web-cli.ts";
import { fakeFiles, native } from "./fixtures.ts";

const ORIGINAL = ".extension-widget-panels{max-height:min(144px,18dvh)}";
const EXEC_PATH = "/opt/node/bin/node";
const DEFAULT_CSS = "/opt/node/lib/node_modules/@agegr/pi-web/.next/static/css/main.css";
const DEFAULT_LAYOUT = "/opt/node/lib/node_modules/@agegr/pi-web/.next/static/chunks/app/layout-abc.js";
const CHUNK = "(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[7177],{}]);";
const context = (files: ReturnType<typeof fakeFiles>, environment: Record<string, string> = {}, popup = false) => ({ files, environment, execPath: EXEC_PATH, percent: () => 50, popup: () => popup });

test("apply は、node の隣に入っている pi-web の CSS に上書きを足し、再読み込みを促す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL });
	const result = run(["apply"], context(files));
	assert.equal(result.exitCode, 0);
	assert.match(files.at(DEFAULT_CSS) ?? "", /max-height:50dvh!important/);
	assert.match(result.lines.join("\n"), /main\.css/);
	assert.match(result.lines.join("\n"), /再読み込み/);
});

test("remove は、足した上書きを外す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL });
	run(["apply"], context(files));
	const result = run(["remove"], context(files));
	assert.equal(result.exitCode, 0);
	assert.equal(files.at(DEFAULT_CSS), ORIGINAL);
});

test("pi-web の場所は、--dir、環境変数 PI_WEB_DIR、node の隣の順に決める", () => {
	const files = fakeFiles({ "/a/.next/static/css/x.css": ORIGINAL, "/b/.next/static/css/y.css": ORIGINAL, [DEFAULT_CSS]: ORIGINAL });
	run(["apply", "--dir", "/a"], context(files, { PI_WEB_DIR: "/b" }));
	assert.deepEqual(files.writes, [native("/a/.next/static/css/x.css")]);
	run(["apply"], context(files, { PI_WEB_DIR: "/b" }));
	assert.deepEqual(files.writes.slice(1), [native("/b/.next/static/css/y.css")]);
});

test("pi-web が見つからなければ、理由を示して失敗で終わる", () => {
	const result = run(["apply"], context(fakeFiles()));
	assert.equal(result.exitCode, 1);
	assert.match(result.lines.join("\n"), /見つかりません/);
});

test("知らない指定には、使い方を示して失敗で終わる", () => {
	for (const argv of [[], ["patch"], ["apply", "--dir"], ["apply", "extra"]]) {
		const result = run(argv, context(fakeFiles({ [DEFAULT_CSS]: ORIGINAL })));
		assert.equal(result.exitCode, 1, argv.join(" "));
		assert.match(result.lines.join("\n"), /使い方/);
	}
});

test("場所を指定しなければ、node の配置から順に探す（Linux の lib/node_modules、Windows の node の隣、Windows の %APPDATA% の npm）", () => {
	const besideNode = "/opt/node/bin/node_modules/@agegr/pi-web/.next/static/css/w.css";
	const windowsLayout = fakeFiles({ [besideNode]: ORIGINAL });
	assert.equal(run(["apply"], context(windowsLayout)).exitCode, 0);
	assert.deepEqual(windowsLayout.writes, [native(besideNode)]);
	const underAppData = "/users/u/AppData/Roaming/npm/node_modules/@agegr/pi-web/.next/static/css/a.css";
	const appDataLayout = fakeFiles({ [underAppData]: ORIGINAL });
	assert.equal(run(["apply"], context(appDataLayout, { APPDATA: "/users/u/AppData/Roaming" })).exitCode, 0);
	assert.deepEqual(appDataLayout.writes, [native(underAppData)]);
});

test("どこにも無ければ、探した場所を並べ、--dir で指定するよう促して失敗で終わる", () => {
	const result = run(["apply"], context(fakeFiles(), { APPDATA: "/users/u/AppData/Roaming" }));
	const text = result.lines.join("\n");
	assert.equal(result.exitCode, 1);
	assert.match(text, /Pi Web が見つかりません/);
	assert.ok(text.includes(native("/opt/node/lib/node_modules/@agegr/pi-web")));
	assert.ok(text.includes(native("/opt/node/bin/node_modules/@agegr/pi-web")));
	assert.ok(text.includes(native("/users/u/AppData/Roaming/npm/node_modules/@agegr/pi-web")));
	assert.match(text, /--dir/);
});

test("場所を指定したときは、そこに無くてもほかを探さない", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL });
	const result = run(["apply", "--dir", "/elsewhere"], context(files));
	assert.equal(result.exitCode, 1);
	assert.match(result.lines.join("\n"), /elsewhere/);
	assert.deepEqual(files.writes, []);
});

test("PI_WEB_DIR が空なら指定が無いものとして扱い、--dir が空なら使い方を示す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL });
	assert.equal(run(["apply"], context(files, { PI_WEB_DIR: "" })).exitCode, 0);
	assert.deepEqual(files.writes, [native(DEFAULT_CSS)]);
	const empty = run(["apply", "--dir", ""], context(files));
	assert.equal(empty.exitCode, 1);
	assert.match(empty.lines.join("\n"), /使い方/);
});

test("apply は、高さの上書きに加えて、小窓のスクリプトを画面の共通部分のチャンクに足す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL, [DEFAULT_LAYOUT]: CHUNK });
	const result = run(["apply"], context(files, {}, true));
	assert.equal(result.exitCode, 0);
	assert.match(files.at(DEFAULT_LAYOUT) ?? "", /installPopup\(window\)/);
	assert.ok((files.at(DEFAULT_LAYOUT) ?? "").startsWith(CHUNK));
	assert.match(result.lines.join("\n"), /小窓のスクリプトを足しました: layout-abc\.js/);
	const again = run(["apply"], context(files, {}, true));
	assert.equal(files.writes.length, 2, "2回目は何も書かない");
	assert.match(again.lines.join("\n"), /小窓のスクリプトはすでに入っています/);
});

test("小窓を切ってあれば、スクリプトは足さず、入っていれば外す。高さの上書きは足す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL, [DEFAULT_LAYOUT]: CHUNK });
	run(["apply"], context(files, {}, true));
	const result = run(["apply"], context(files, {}, false));
	assert.equal(result.exitCode, 0);
	assert.equal(files.at(DEFAULT_LAYOUT), CHUNK);
	assert.match(files.at(DEFAULT_CSS) ?? "", /max-height:50dvh/);
	assert.match(result.lines.join("\n"), /小窓のスクリプトを外しました/);
});

test("remove は、高さの上書きと小窓のスクリプトの両方を外す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL, [DEFAULT_LAYOUT]: CHUNK });
	run(["apply"], context(files, {}, true));
	const result = run(["remove"], context(files, {}, true));
	assert.equal(result.exitCode, 0);
	assert.deepEqual([files.at(DEFAULT_CSS), files.at(DEFAULT_LAYOUT)], [ORIGINAL, CHUNK]);
});

test("スクリプトを足す先が無ければ、高さの上書きは足したうえで、理由を示して失敗で終わる", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL });
	const result = run(["apply"], context(files, {}, true));
	assert.equal(result.exitCode, 1);
	assert.match(files.at(DEFAULT_CSS) ?? "", /max-height:50dvh/);
	assert.match(result.lines.join("\n"), /小窓のスクリプトを足す先がありません/);
	assert.equal(run(["remove"], context(files, {}, true)).exitCode, 0, "外すときは、足す先が無くても失敗にしない");
});
