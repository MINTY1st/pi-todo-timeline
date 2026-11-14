// pi-timeline: 長い作業の進み具合を、一定の間隔のレポートで残す pi の拡張機能。使い方は README.md
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { configPath, loadConfig } from "./src/config.ts";
import { createExtension } from "./src/extension.ts";

const configLocation = configPath(process.env);

export default createExtension({
	loadConfig: () => loadConfig(configLocation, (path) => readFileSync(path, "utf8")),
	configLocation,
	now: Date.now,
	newId: randomUUID,
	timeZone: undefined,
});
