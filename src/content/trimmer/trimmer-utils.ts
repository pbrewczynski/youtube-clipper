export {
	getVideoIdFromUrl,
	getVideoTitle,
	getVideoDuration,
	getProgressiveFormatUrl,
	getAdaptiveStreamUrls,
	parseStoryboard,
	getStoryboardTileUrl,
} from '../../utils/youtube-player';

import type { StreamUrls } from '../../messaging';
import { hasUsableStreams, sniffStreamsFromPerformance } from './performance-streams';

export { hasUsableStreams };

function isValidStreamUrl(url?: string): url is string {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.length > 0;
	} catch {
		return false;
	}
}

function pickCapturedUrl(url?: string): string | undefined {
	return isValidStreamUrl(url) ? url : undefined;
}

export async function getCapturedStreamsFromPage(): Promise<StreamUrls> {
	const fromPerformance = sniffStreamsFromPerformance();
	try {
		const fromBackground = (await chrome.runtime.sendMessage({ type: 'GET_STREAMS' })) ?? {};
		return {
			progressiveUrl: pickCapturedUrl(fromBackground.progressiveUrl ?? fromPerformance.progressiveUrl),
			videoUrl: pickCapturedUrl(fromBackground.videoUrl ?? fromPerformance.videoUrl),
			audioUrl: pickCapturedUrl(fromBackground.audioUrl ?? fromPerformance.audioUrl),
		};
	} catch {
		return {
			progressiveUrl: pickCapturedUrl(fromPerformance.progressiveUrl),
			videoUrl: pickCapturedUrl(fromPerformance.videoUrl),
			audioUrl: pickCapturedUrl(fromPerformance.audioUrl),
		};
	}
}

/** Only network-captured URLs — player-response URLs often 403 without a live session. */
export async function resolveStreamUrls(): Promise<StreamUrls> {
	const streams = await getCapturedStreamsFromPage();

	if (hasUsableStreams(streams)) {
		chrome.runtime.sendMessage({ type: 'REGISTER_STREAMS', streams }).catch(() => {});
	}

	return streams;
}

export async function checkBridgeHealth(): Promise<boolean> {
	try {
		const res = await fetch('http://localhost:5005/trim', { method: 'OPTIONS' });
		return res.ok;
	} catch {
		return false;
	}
}