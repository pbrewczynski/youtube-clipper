import type { StreamUrls } from '../../messaging';

export function sniffStreamsFromPerformance(): StreamUrls {
	const streams: StreamUrls = {};
	const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

	for (const entry of entries) {
		const url = entry.name;
		if (!url.includes('googlevideo.com/videoplayback')) continue;

		const isProgressive =
			url.includes('mime=video%2Fmp4') &&
			(url.includes('acont%3D1') || url.includes('itag=18') || url.includes('itag=22'));

		if (isProgressive) {
			streams.progressiveUrl = url;
		} else if (url.includes('mime=audio') || url.includes('itag=140') || url.includes('itag=251')) {
			streams.audioUrl = url;
		} else if (url.includes('mime=video')) {
			const existing = streams.videoUrl;
			const isMp4 = url.includes('mime=video%2Fmp4');
			const existingIsMp4 = existing?.includes('mime=video%2Fmp4');
			if (!existing || (isMp4 && !existingIsMp4)) {
				streams.videoUrl = url;
			}
		}
	}

	return streams;
}

export function hasUsableStreams(streams: StreamUrls): boolean {
	return !!(streams.progressiveUrl || streams.videoUrl);
}