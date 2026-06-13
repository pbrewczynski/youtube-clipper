import { getContentStorage } from './local-storage';
import { initTrimmer } from './trimmer';
import { startClipPlayback, stopClipPlayback } from './clip-playback';

initTrimmer();

let prevId = '';
let storage: Awaited<ReturnType<typeof getContentStorage>> | undefined;

function getVideoIdFromLocation(): string | null {
	const href = window.location.href;
	const watchMatch = href.match(/[?&]v=([^&#]+)/);
	if (watchMatch?.[1]) return watchMatch[1];
	const shortsMatch = href.match(/\/shorts\/([^/?&#]+)/);
	return shortsMatch?.[1] ?? null;
}

async function main() {
	if (!window.location.href.includes('youtube.com')) return;
	try {
		storage = await getContentStorage();
		const observer = new MutationObserver(onPageChange);
		observer.observe(document.body, { childList: true, subtree: false });
		onPageChange();
	} catch {
		// Extension context invalidated (reload/update) — ignore quietly.
	}
}

function onPageChange() {
	const videoId = getVideoIdFromLocation();
	if (!videoId || !storage) return;
	if (videoId === prevId) return;

	prevId = videoId;
	stopClipPlayback();
	startClipPlayback(storage, videoId);
}

void main();

export { stopClipPlayback };