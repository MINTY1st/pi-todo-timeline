// 前回のレポートより後のセッションの記録を、要約に渡す文に直す
import { clip, isObject } from "./shared.ts";
import type { Fields } from "./shared.ts";

export interface DeltaLimits {
	/** 1回の要約に渡す文字数の上限。超えた分は次回に持ち越す */
	maxChars: number;
	/** 発言やツールの結果の1件あたりの文字数の上限 */
	maxItemChars: number;
}

export interface Delta {
	text: string;
	start: number | null;
	/** 含めた最後のエントリの時刻。次回はこれより後から始める */
	end: number | null;
	toolCount: number;
	truncated: boolean;
}

interface DeltaItem {
	time: number;
	lines: string[];
	toolCalls: number;
}

const clockOf = (time: number): string => new Date(time).toISOString().slice(11, 16);

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((block) => isObject(block) && block.type === "text" && typeof block.text === "string").map((block) => (block as Fields).text).join(" ");
}

function assistantLines(content: unknown, maxChars: number): { lines: string[]; toolCalls: number } {
	const lines: string[] = [];
	let toolCalls = 0;
	for (const block of Array.isArray(content) ? content : []) {
		if (!isObject(block)) continue;
		if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") lines.push(`アシスタント: ${clip(block.text, maxChars)}`);
		if (block.type === "toolCall") {
			toolCalls++;
			lines.push(`ツールの呼び出し ${String(block.name)}: ${clip(JSON.stringify(block.arguments ?? {}), maxChars)}`);
		}
	}
	return { lines, toolCalls };
}

function messageLines(message: Fields, maxChars: number): { lines: string[]; toolCalls: number } {
	if (message.role === "assistant") return assistantLines(message.content, maxChars);
	const body = clip(textOf(message.content), maxChars);
	if (body === "") return { lines: [], toolCalls: 0 };
	if (message.role === "user") return { lines: [`ユーザー: ${body}`], toolCalls: 0 };
	if (message.role !== "toolResult") return { lines: [], toolCalls: 0 };
	const failed = message.isError === true ? "（失敗）" : "";
	return { lines: [`ツールの結果 ${String(message.toolName)}${failed}: ${body}`], toolCalls: 0 };
}

/** afterTime 以前のエントリは、文に直す前に飛ばす（毎ターン全体をたどるため） */
function describeEntry(entry: unknown, afterTime: number, maxChars: number): DeltaItem | undefined {
	if (!isObject(entry) || typeof entry.timestamp !== "string") return undefined;
	const time = Date.parse(entry.timestamp);
	if (Number.isNaN(time) || time <= afterTime) return undefined;
	if (entry.type === "message" && isObject(entry.message)) return { time, ...messageLines(entry.message, maxChars) };
	if (entry.type !== "custom_message") return undefined;
	const body = clip(textOf(entry.content), maxChars);
	return { time, lines: body === "" ? [] : [`通知 ${String(entry.customType)}: ${body}`], toolCalls: 0 };
}

function pendingItems(entries: Iterable<unknown>, afterTime: number, maxItemChars: number): DeltaItem[] {
	const items: DeltaItem[] = [];
	for (const entry of entries) {
		const item = describeEntry(entry, afterTime, maxItemChars);
		if (item !== undefined && item.lines.length > 0) items.push(item);
	}
	return items;
}

/**
 * afterTime より後のエントリを古い順に文へ直す。
 * 全体が上限を超えたら入る分だけ入れ、end をそこまでの時刻にする（同じ時刻のエントリは分けない）。
 */
export function collectDelta(entries: Iterable<unknown>, afterTime: number, limits: DeltaLimits): Delta {
	const items = pendingItems(entries, afterTime, limits.maxItemChars);
	const lines: string[] = [];
	let used = 0;
	let toolCount = 0;
	let end: number | null = null;
	let taken = 0;
	for (const item of items) {
		const itemLines = item.lines.map((line) => `[${clockOf(item.time)}] ${line}`);
		const size = itemLines.reduce((sum, line) => sum + line.length + 1, 0);
		if (taken > 0 && used + size > limits.maxChars && item.time !== end) break;
		lines.push(...itemLines);
		used += size;
		toolCount += item.toolCalls;
		end = item.time;
		taken++;
	}
	return { text: lines.join("\n"), start: items[0]?.time ?? null, end, toolCount, truncated: taken < items.length };
}
