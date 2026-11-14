// Pi Web のパネルの高さの上書きを足す・外すコマンド。使い方は README.md の「パネルの高さ」
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configPath, loadConfig } from "./config.ts";
import { createFileAccess } from "./files.ts";
import { applyToDirectory, buildRule } from "./web-css.ts";
import type { CssFiles, CssOutcome } from "./web-css.ts";

export interface CliContext {
	files: CssFiles;
	environment: Record<string, string | undefined>;
	/** 実行している node の場所。Pi Web の既定の場所を決めるのに使う */
	execPath: string;
	/** 設定の panelMaxHeightPercent */
	percent(): number;
}

type Action = "apply" | "remove";

const USAGE = [
	"使い方: node src/web-css-cli.ts <apply|remove> [--dir <Pi Web のディレクトリ>]",
	"  apply   パネルの高さの上限を、設定の panelMaxHeightPercent（画面の高さに対する %）にする",
	"  remove  足した上書きを外す",
	"  Pi Web の場所は、--dir、環境変数 PI_WEB_DIR、node の隣の lib/node_modules/@agegr/pi-web の順に決める",
];
const RELOAD_HINT = "ブラウザでキャッシュを使わない再読み込み（Ctrl+Shift+R）をすると反映されます";

function parse(argv: readonly string[]): { action: Action; directory: string | undefined } | undefined {
	const [action, flag, directory, ...rest] = argv;
	if (action !== "apply" && action !== "remove") return undefined;
	if (flag === undefined) return { action, directory: undefined };
	if (flag !== "--dir" || directory === undefined || rest.length > 0) return undefined;
	return { action, directory };
}

function report(action: Action, outcome: CssOutcome, percent: number | undefined): string[] {
	if (action === "remove") return outcome.changed.length > 0 ? [`上書きを外しました: ${outcome.changed.join(", ")}`, RELOAD_HINT] : ["上書きは入っていません"];
	const height = `画面の高さの ${percent}% `;
	if (outcome.changed.length === 0) return [`上書きはすでに入っています（${height.trim()}）: ${outcome.unchanged.join(", ")}`];
	return [`パネルの高さの上限を${height}にする上書きを足しました: ${outcome.changed.join(", ")}`, RELOAD_HINT];
}

export function run(argv: readonly string[], context: CliContext): { exitCode: number; lines: string[] } {
	const parsed = parse(argv);
	if (parsed === undefined) return { exitCode: 1, lines: USAGE };
	const piWeb = parsed.directory ?? context.environment.PI_WEB_DIR ?? join(dirname(context.execPath), "..", "lib", "node_modules", "@agegr", "pi-web");
	const percent = parsed.action === "apply" ? context.percent() : undefined;
	const outcome = applyToDirectory(context.files, join(piWeb, ".next", "static", "css"), percent === undefined ? undefined : buildRule(percent));
	if (!outcome.ok) return { exitCode: 1, lines: [outcome.message] };
	return { exitCode: 0, lines: report(parsed.action, outcome, percent) };
}

if (import.meta.main) {
	const percent = (): number => loadConfig(configPath(process.env), (path) => readFileSync(path, "utf8")).config.panelMaxHeightPercent;
	const result = run(process.argv.slice(2), { files: createFileAccess(), environment: process.env, execPath: process.execPath, percent });
	for (const line of result.lines) console.log(line);
	process.exitCode = result.exitCode;
}
