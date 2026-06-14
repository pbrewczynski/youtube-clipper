import type { StreamUrls } from '../messaging';

const streamsByTab = new Map<number, StreamUrls>();

export function initStreamCapture() {
	if (!chrome.webRequest || !chrome.webRequest.onBeforeRequest) {
		console.warn('chrome.webRequest.onBeforeRequest is not available. Stream capture via network events will be disabled.');
		return;
	}

	chrome.webRequest.onBeforeRequest.addListener(
		(details) => {
			if (details.tabId < 0) return;

			const url = details.url;
			if (!url.includes('googlevideo.com/videoplayback')) return;

			const current = streamsByTab.get(details.tabId) ?? {};
			const isProgressive =
				url.includes('mime=video%2Fmp4') &&
				(url.includes('acont%3D1') || url.includes('itag=18') || url.includes('itag=22'));

			if (isProgressive) {
				current.progressiveUrl = url;
			} else if (url.includes('mime=audio') || url.includes('itag=140') || url.includes('itag=251')) {
				current.audioUrl = url;
			} else if (url.includes('mime=video') || url.includes('itag=137') || url.includes('itag=248')) {
				const isMp4 = url.includes('mime=video%2Fmp4') || url.includes('itag=137');
				const existingIsMp4 =
					current.videoUrl?.includes('mime=video%2Fmp4') || current.videoUrl?.includes('itag=137');
				if (!current.videoUrl || (isMp4 && !existingIsMp4)) {
					current.videoUrl = url;
				}
			}

			streamsByTab.set(details.tabId, current);
		},
		{ urls: ['*://*.googlevideo.com/videoplayback*'] }
	);

	chrome.tabs.onRemoved.addListener((tabId) => {
		streamsByTab.delete(tabId);
	});
}

export function getCapturedStreams(tabId: number): StreamUrls {
	return streamsByTab.get(tabId) ?? {};
}

export function setCapturedStreams(tabId: number, streams: StreamUrls) {
	streamsByTab.set(tabId, { ...streamsByTab.get(tabId), ...streams });
}