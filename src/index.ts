// pi-todo-timeline: タスクと、一定の間隔の進み具合のレポートを1つにまとめて見せる pi の拡張機能。使い方は README.md
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { configPath, loadConfig } from "./core/config.ts";
import { createExtension } from "./extension.ts";
import { createFileAccess } from "./core/files.ts";

const configLocation = configPath(process.env, homedir());

export default createExtension({
	files: createFileAccess(),
	loadConfig: () => loadConfig(configLocation, (path) => readFileSync(path, "utf8")),
	configLocation,
	now: Date.now,
	newId: randomUUID,
	timeZone: undefined,
	// Pi Web は、自分のパッケージの置き場を作業ディレクトリにして動く。そこが Pi Web なら小窓を当てる
	piWebDirectory: process.cwd(),
});
