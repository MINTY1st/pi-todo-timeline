// pi のうち、この拡張が使う部分の型と、モデルの呼び出し
import type { TimelineConfig } from "./config.ts";
import type { ModelRequest } from "./prompt.ts";

interface ModelResponse {
	content: unknown[];
	stopReason: string;
	errorMessage?: string;
}

export interface ModelRegistryLike {
	find(provider: string, modelId: string): object | undefined;
	hasConfiguredAuth(model: object): boolean;
	streamSimple(
		model: object,
		context: { systemPrompt: string; messages: Array<{ role: "user"; content: Array<{ type: "text"; text: string }>; timestamp: number }> },
		options: { signal: AbortSignal; maxTokens: number; reasoning?: string },
	): { result(): Promise<ModelResponse> };
}

export interface HostContext {
	hasUI: boolean;
	cwd: string;
	sessionManager: {
		getBranch(): Iterable<unknown>;
		getSessionId(): string;
		getHeader(): { timestamp?: string } | null | undefined;
		getSessionName?(): string | undefined;
	};
	ui: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		/** 入力欄の上か下に、文字の行のパネルを出す。undefined を渡すと消す */
		setWidget(key: string, lines: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
	};
	modelRegistry: ModelRegistryLike;
}

export interface TimelineHost {
	on(event: "session_start" | "turn_end" | "session_shutdown", handler: (event: unknown, context: HostContext) => unknown): void;
	registerCommand(name: string, options: { description: string; handler: (argumentText: string, context: HostContext) => Promise<void> }): void;
	appendEntry(customType: string, data: unknown): void;
}

export type Target = { model: object } | { reason: string };

/** レポートを書かせるモデルを決める。使えなければ、その理由を返す */
export function findTarget(config: TimelineConfig, registry: ModelRegistryLike, configLocation: string): Target {
	if (!config.enabled) return { reason: "レポートは無効にしてあります（enabled が false）" };
	if (config.provider === undefined || config.model === undefined) {
		return { reason: `レポートのモデルが未設定です。${configLocation} に provider と model を書いてください` };
	}
	const name = `${config.provider}/${config.model}`;
	const model = registry.find(config.provider, config.model);
	if (model === undefined) return { reason: `レポートのモデル ${name} が見つかりません` };
	if (!registry.hasConfiguredAuth(model)) return { reason: `レポートのモデル ${name} の認証が設定されていません` };
	return { model };
}

const isTextBlock = (block: unknown): block is { type: "text"; text: string } =>
	typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string";

/** モデルに依頼を送り、返答の文を返す。モデルが失敗や中断を返したら例外にする */
export async function completeText(registry: ModelRegistryLike, model: object, request: ModelRequest, config: TimelineConfig, signal: AbortSignal): Promise<string> {
	const options = {
		signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
		maxTokens: config.maxOutputTokens,
		// 思考を切れないモデルがあるので、設定に書かれたときだけ渡す
		...(config.reasoning === undefined ? {} : { reasoning: config.reasoning }),
	};
	const context = { systemPrompt: request.system, messages: [{ role: "user" as const, content: [{ type: "text" as const, text: request.user }], timestamp: Date.now() }] };
	const response = await registry.streamSimple(model, context, options).result();
	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(response.errorMessage ?? `モデルの応答が ${response.stopReason} で終わった`);
	}
	const text = response.content.filter(isTextBlock).map((block) => block.text).join("");
	// 中身の無い返答を直しに回すと、中身の無いレポートができるので、ここで失敗にする
	if (text.trim() === "") throw new Error(`モデルの返答に文がありません（${response.stopReason}）`);
	if (response.stopReason === "length") throw new Error("モデルの返答が出力の上限に達して途中で切れました。maxOutputTokens を上げるか、reasoning を下げてください");
	return text;
}
