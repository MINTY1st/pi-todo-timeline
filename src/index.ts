// pi-todo-timeline: タスクと、一定の間隔の進み具合のレポートを1つにまとめて見せる pi の拡張機能。使い方は README.md
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { configPath, loadConfig } from "./config.ts";
import { createExtension } from "./extension.ts";
import { createFileAccess } from "./files.ts";

const configLocation = configPath(process.env);

export default createExtension({
	files: createFileAccess(),
	loadConfig: () => loadConfig(configLocation, (path) => readFileSync(path, "utf8")),
	configLocation,
	now: Date.now,
	newId: randomUUID,
	timeZone: undefined,
});
