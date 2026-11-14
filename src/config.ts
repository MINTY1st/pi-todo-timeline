// 設定ファイルの読み込みと検証
import { join } from "node:path";

export interface TimelineConfig {
	enabled: boolean;
	/** レポートを書かせるモデル。どちらかが未設定ならレポートは作らない */
	provider: string | undefined;
	model: string | undefined;
	/** モデルに頼む思考の強さ（pi の thinking level）。undefined なら指定しない */
	reasoning: string | undefined;
	intervalMs: number;
	/** 基本のレポートの間隔の何倍で束ねるか */
	rollupFactor: number;
	maxInputChars: number;
	maxItemChars: number;
	maxLineChars: number;
	language: string;
	focus: string;
	timeoutMs: number;
	maxOutputTokens: number;
	notify: boolean;
	/** タスクとレポートを HTML のページに書き出す */
	page: boolean;
	/** ページの置き場。相対パスなら作業ディレクトリから */
	pageDirectory: string;
	/** todo ツールを登録する。別の拡張の todo と一緒に使うときは false にする（同じ名前のツールが2つあると、pi は起動に失敗する） */
	todoTool: boolean;
	/** 入力欄の上に、色つきの文字のパネルを出す */
	panel: boolean;
	panelMaxTasks: number;
	/** Pi Web のパネルの高さの上限を、画面の高さの何 % にするか（上書きのコマンドが使う） */
	panelMaxHeightPercent: number;
}

export interface LoadedConfig {
	config: TimelineConfig;
	problems: string[];
}

interface NumberRule {
	min: number;
	max: number;
	fallback: number;
}

const DEFAULT_LANGUAGE = "日本語";
const DEFAULT_PAGE_DIRECTORY = ".pi/timeline";
const DEFAULT_FOCUS = "Focus on what changed and why it matters to the user's goal. Lead with a concrete result or finding. Add useful evidence, consequences, and remaining gaps when the record supports them.";
const NUMBER_RULES = {
	intervalMinutes: { min: 1, max: 1440, fallback: 15 },
	rollupFactor: { min: 2, max: 24, fallback: 4 },
	maxInputChars: { min: 1000, max: 400_000, fallback: 40_000 },
	maxItemChars: { min: 50, max: 5000, fallback: 600 },
	maxLineChars: { min: 40, max: 1000, fallback: 160 },
	timeoutSeconds: { min: 5, max: 600, fallback: 120 },
	maxOutputTokens: { min: 200, max: 16_000, fallback: 4000 },
	panelMaxTasks: { min: 1, max: 50, fallback: 10 },
	panelMaxHeightPercent: { min: 10, max: 90, fallback: 50 },
} satisfies Record<string, NumberRule>;

type Fields = Record<string, unknown>;

function createReader(fields: Fields, problems: string[]) {
	return {
		text(key: string): string | undefined {
			const value = fields[key];
			if (value === undefined) return undefined;
			if (typeof value === "string" && value.trim() !== "") return value;
			problems.push(`${key} は空でない文字列で書く`);
			return undefined;
		},
		count(key: keyof typeof NUMBER_RULES): number {
			const rule = NUMBER_RULES[key];
			const value = fields[key];
			if (value === undefined) return rule.fallback;
			if (typeof value === "number" && Number.isInteger(value) && value >= rule.min && value <= rule.max) return value;
			problems.push(`${key} は ${rule.min}〜${rule.max} の整数で書く（既定の ${rule.fallback} を使う）`);
			return rule.fallback;
		},
		flag(key: string, fallback: boolean): boolean {
			const value = fields[key];
			if (value === undefined || typeof value === "boolean") return value ?? fallback;
			problems.push(`${key} は true か false で書く`);
			return fallback;
		},
	};
}

/** 設定の値を確かめる。使えない値は既定値に戻し、どの項目かを problems に入れる */
export function resolveConfig(raw: unknown): LoadedConfig {
	const problems: string[] = [];
	const isFields = typeof raw === "object" && raw !== null && !Array.isArray(raw);
	if (!isFields) problems.push("設定は JSON のオブジェクトで書く");
	const reader = createReader(isFields ? (raw as Fields) : {}, problems);
	const texts = { provider: reader.text("provider"), model: reader.text("model"), language: reader.text("language"), focus: reader.text("focus"), reasoning: reader.text("reasoning"), pageDirectory: reader.text("pageDirectory") };
	const config: TimelineConfig = {
		provider: texts.provider,
		model: texts.model,
		reasoning: texts.reasoning,
		language: texts.language ?? DEFAULT_LANGUAGE,
		focus: texts.focus ?? DEFAULT_FOCUS,
		intervalMs: reader.count("intervalMinutes") * 60_000,
		rollupFactor: reader.count("rollupFactor"),
		maxInputChars: reader.count("maxInputChars"),
		maxItemChars: reader.count("maxItemChars"),
		maxLineChars: reader.count("maxLineChars"),
		timeoutMs: reader.count("timeoutSeconds") * 1000,
		maxOutputTokens: reader.count("maxOutputTokens"),
		enabled: reader.flag("enabled", true),
		notify: reader.flag("notify", true),
		page: reader.flag("page", true),
		todoTool: reader.flag("todoTool", true),
		panel: reader.flag("panel", true),
		panelMaxTasks: reader.count("panelMaxTasks"),
		panelMaxHeightPercent: reader.count("panelMaxHeightPercent"),
		pageDirectory: texts.pageDirectory ?? DEFAULT_PAGE_DIRECTORY,
	};
	return { config, problems };
}

export function configPath(environment: Record<string, string | undefined>): string {
	if (environment.PI_TODO_TIMELINE_CONFIG) return environment.PI_TODO_TIMELINE_CONFIG;
	const base = environment.XDG_CONFIG_HOME || join(environment.HOME ?? "", ".config");
	return join(base, "pi-todo-timeline", "config.json");
}

/** 設定ファイルを読む。ファイルが無ければ既定値、読めなければ既定値にして problems で知らせる */
export function loadConfig(path: string, readFile: (path: string) => string): LoadedConfig {
	let content: string;
	try {
		content = readFile(path);
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return resolveConfig({});
		return { ...resolveConfig({}), problems: [`${path} を読めない: ${(error as Error).message}`] };
	}
	try {
		return resolveConfig(JSON.parse(content));
	} catch (error) {
		return { ...resolveConfig({}), problems: [`${path} が JSON として読めない: ${(error as Error).message}`] };
	}
}
