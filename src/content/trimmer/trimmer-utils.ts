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

export async function resolveStreamUrls(): Promise<StreamUrls> {
	const captured = await getCapturedStreamsFromPage();
	const fromPlayer = getAdaptiveStreamUrls();

	const streams: StreamUrls = {
		progressiveUrl: captured.progressiveUrl ?? fromPlayer.progressiveUrl,
		videoUrl: captured.videoUrl ?? fromPlayer.videoUrl,
		audioUrl: captured.audioUrl ?? fromPlayer.audioUrl,
	};

	if (hasUsableStreams(streams)) {
		chrome.runtime.sendMessage({ type: 'REGISTER_STREAMS', streams }).catch(() => {});
	}

	return streams;
}