// Pi Web に、パネルの高さの上書きと小窓のスクリプトを足す・外すコマンド。使い方は README.md
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configPath, loadConfig } from "../core/config.ts";
import { createFileAccess } from "../core/files.ts";
import { cssDirectoryOf, patchPiWeb } from "./sync.ts";
import type { Action, PatchSettings } from "./sync.ts";

export interface CliContext extends PatchSettings {
	environment: Record<string, string | undefined>;
	/** 実行している node の場所。Pi Web の既定の場所を決めるのに使う */
	execPath: string;
}

const USAGE = [
	"使い方: node src/pi-web-cli.ts <apply|remove> [--dir <Pi Web のディレクトリ>]",
	"  apply   パネルの高さの上限を設定の panelMaxHeightPercent にし、小窓のスクリプトを足す（設定の webPopup が false なら足さない）",
	"  remove  足したものを外す",
	"  Pi Web の場所は、--dir、環境変数 PI_WEB_DIR の順に決め、どちらも無ければ npm が全体に入れた場所を探す",
];

function parse(argv: readonly string[]): { action: Action; directory: string | undefined } | undefined {
	const [action, flag, directory, ...rest] = argv;
	if (action !== "apply" && action !== "remove") return undefined;
	if (flag === undefined) return { action, directory: undefined };
	if (flag !== "--dir" || !directory || rest.length > 0) return undefined;
	return { action, directory };
}

/** 場所の指定が無いときに探す所。npm が全体に入れたパッケージの置き場は、OS と Node の入れ方で違う */
function defaultLocations(context: CliContext): string[] {
	const besideNode = dirname(context.execPath);
	const appData = context.environment.APPDATA;
	return [
		join(besideNode, "..", "lib", "node_modules", "@agegr", "pi-web"), // Linux と macOS
		join(besideNode, "node_modules", "@agegr", "pi-web"), // Windows で、node と同じ場所に入れる構成
		...(appData ? [join(appData, "npm", "node_modules", "@agegr", "pi-web")] : []), // Windows の npm の既定
	];
}

/** Pi Web の場所を決める。指定があればそれを使い、無ければ CSS の置き場がある最初の候補を使う */
function locate(directory: string | undefined, context: CliContext): string | string[] {
	const chosen = directory ?? (context.environment.PI_WEB_DIR || undefined);
	if (chosen !== undefined) return chosen;
	const candidates = defaultLocations(context);
	return candidates.find((candidate) => context.files.list(cssDirectoryOf(candidate)) !== undefined) ?? candidates;
}

export function run(argv: readonly string[], context: CliContext): { exitCode: number; lines: string[] } {
	const parsed = parse(argv);
	if (parsed === undefined) return { exitCode: 1, lines: USAGE };
	const piWeb = locate(parsed.directory, context);
	if (typeof piWeb === "string") return patchPiWeb(piWeb, parsed.action, context);
	return { exitCode: 1, lines: ["Pi Web が見つかりません。探した場所:", ...piWeb.map((candidate) => `  ${candidate}`), "--dir <Pi Web のディレクトリ> で場所を指定してください"] };
}

if (import.meta.main) {
	const settings = (): ReturnType<typeof loadConfig>["config"] => loadConfig(configPath(process.env, homedir()), (path) => readFileSync(path, "utf8")).config;
	const result = run(process.argv.slice(2), { files: createFileAccess(), environment: process.env, execPath: process.execPath, percent: () => settings().panelMaxHeightPercent, popup: () => settings().webPopup });
	for (const line of result.lines) console.log(line);
	process.exitCode = result.exitCode;
}
