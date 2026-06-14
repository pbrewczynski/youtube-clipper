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
import { getAdaptiveStreamUrls } from '../../utils/youtube-player';
import { hasUsableStreams, sniffStreamsFromPerformance } from './performance-streams';

export { hasUsableStreams };

export async function getCapturedStreamsFromPage(): Promise<StreamUrls> {
	const fromPerformance = sniffStreamsFromPerformance();
	try {
		const fromBackground = (await chrome.runtime.sendMessage({ type: 'GET_STREAMS' })) ?? {};
		return { ...fromBackground, ...fromPerformance };
	} catch {
		return fromPerformance;
	}
}

function isValidStreamUrl(url?: string): url is string {
	if (!url) return false;
	try {
		const parsed = new URL(url);
		return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.length > 0;
	} catch {
		return false;
	}
}

function pickUrl(captured?: string, fallback?: string): string | undefined {
	if (isValidStreamUrl(captured)) return captured;
	if (isValidStreamUrl(fallback)) return fallback;
	return undefined;
}

export async function resolveStreamUrls(): Promise<StreamUrls> {
	const captured = await getCapturedStreamsFromPage();
	const fromPlayer = getAdaptiveStreamUrls();

	const streams: StreamUrls = {
		progressiveUrl: pickUrl(captured.progressiveUrl, fromPlayer.progressiveUrl),
		videoUrl: pickUrl(captured.videoUrl, fromPlayer.videoUrl),
		audioUrl: pickUrl(captured.audioUrl, fromPlayer.audioUrl),
	};

	if (hasUsableStreams(streams)) {
		chrome.runtime.sendMessage({ type: 'REGISTER_STREAMS', streams }).catch(() => {});
	}

	return streams;
}