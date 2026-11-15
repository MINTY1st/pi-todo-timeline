// Pi Web の中で動いているとき、セッションの始まりに Pi Web へ小窓と高さの上書きを当てる（利用者がコマンドを打たなくて済むように）
import type { HostContext } from "./host.ts";
import { isPiWeb, patchPiWeb, RELOAD_HINT } from "./pi-web-sync.ts";
import { messageOf, settingsOf } from "./session.ts";
import type { Session } from "./session.ts";

const UPDATED = `Pi Web に、タイムラインの小窓とパネルの高さの設定を当てました。${RELOAD_HINT}`;

function notifyOnce(session: Session, context: HostContext, message: string): void {
	if (session.piWebNotice === message) return;
	session.piWebNotice = message;
	context.ui.notify(message, "warning");
}

/** Pi Web の外（ターミナルの pi など）では何もしない。失敗しても、セッションの始まりの処理は止めない */
export function syncPiWeb(session: Session, context: HostContext): void {
	const { files, piWebDirectory } = session.options;
	if (piWebDirectory === undefined || !isPiWeb(piWebDirectory, files)) return;
	const { config } = settingsOf(session);
	try {
		const result = patchPiWeb(piWebDirectory, "apply", { files, percent: () => config.panelMaxHeightPercent, popup: () => config.webPopup });
		if (result.exitCode !== 0) notifyOnce(session, context, `Pi Web に小窓を当てられませんでした: ${result.lines.join(" ")}`);
		else if (result.lines.includes(RELOAD_HINT)) context.ui.notify(UPDATED, "info");
	} catch (error) {
		notifyOnce(session, context, `Pi Web のファイルに書けないため、小窓は使えません（${messageOf(error)}）`);
	}
}
