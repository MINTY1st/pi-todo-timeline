import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/web-css-cli.ts";
import { fakeFiles } from "./fixtures.ts";

const ORIGINAL = ".extension-widget-panels{max-height:min(144px,18dvh)}";
const EXEC_PATH = "/opt/node/bin/node";
const DEFAULT_CSS = "/opt/node/lib/node_modules/@agegr/pi-web/.next/static/css/main.css";
const context = (files: ReturnType<typeof fakeFiles>, environment: Record<string, string> = {}) => ({ files, environment, execPath: EXEC_PATH, percent: () => 50 });

test("apply は、node の隣に入っている pi-web の CSS に上書きを足し、再読み込みを促す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL });
	const result = run(["apply"], context(files));
	assert.equal(result.exitCode, 0);
	assert.match(files.stored.get(DEFAULT_CSS) ?? "", /max-height:50dvh!important/);
	assert.match(result.lines.join("\n"), /main\.css/);
	assert.match(result.lines.join("\n"), /再読み込み/);
});

test("remove は、足した上書きを外す", () => {
	const files = fakeFiles({ [DEFAULT_CSS]: ORIGINAL });
	run(["apply"], context(files));
	const result = run(["remove"], context(files));
	assert.equal(result.exitCode, 0);
	assert.equal(files.stored.get(DEFAULT_CSS), ORIGINAL);
});

test("pi-web の場所は、--dir、環境変数 PI_WEB_DIR、node の隣の順に決める", () => {
	const files = fakeFiles({ "/a/.next/static/css/x.css": ORIGINAL, "/b/.next/static/css/y.css": ORIGINAL, [DEFAULT_CSS]: ORIGINAL });
	run(["apply", "--dir", "/a"], context(files, { PI_WEB_DIR: "/b" }));
	assert.deepEqual(files.writes, ["/a/.next/static/css/x.css"]);
	run(["apply"], context(files, { PI_WEB_DIR: "/b" }));
	assert.deepEqual(files.writes.slice(1), ["/b/.next/static/css/y.css"]);
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
