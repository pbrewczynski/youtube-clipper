import type { StreamUrls } from '../messaging';

const FETCH_HEADERS = {
	Referer: 'https://www.youtube.com/',
	Origin: 'https://www.youtube.com',
};

type FetchInit = {
	method: 'GET' | 'HEAD';
	headers: Record<string, string>;
};

type FetchPageResult =
	| { ok: true; bytes: number[] }
	| { ok: true; contentLength: number }
	| { ok: false; status: number };

async function runFetchInTab(tabId: number, url: string, init: FetchInit): Promise<FetchPageResult> {
	const [injection] = await chrome.scripting.executeScript({
		target: { tabId },
		world: 'MAIN',
		func: (fetchUrl: string, fetchInit: FetchInit) => {
			return fetch(fetchUrl, {
				method: fetchInit.method,
				headers: fetchInit.headers,
				credentials: 'include',
			})
				.then(async (res) => {
					if (!res.ok) return { ok: false as const, status: res.status };
					if (fetchInit.method === 'HEAD') {
						return {
							ok: true as const,
							contentLength: parseInt(res.headers.get('content-length') ?? '0', 10),
						};
					}
					const ab = await res.arrayBuffer();
					return { ok: true as const, bytes: Array.from(new Uint8Array(ab)) };
				})
				.catch(() => ({ ok: false as const, status: 0 }));
		},
		args: [url, init],
	});

	if (!injection?.result) {
		throw new Error('Could not access the YouTube tab — refresh the page and retry.');
	}

	return injection.result as FetchPageResult;
}

function httpError(status: number): Error {
	if (status === 403) {
		return new Error('Stream blocked (403) — play the video for ~10 seconds, then retry Trim & Download.');
	}
	return new Error(status ? `Stream download failed (HTTP ${status})` : 'Stream download failed');
}

async function fetchContentLength(tabId: number, url: string): Promise<number> {
	const result = await runFetchInTab(tabId, url, {
		method: 'HEAD',
		headers: FETCH_HEADERS,
	});

	if (!result.ok) return 0;
	if ('contentLength' in result) return result.contentLength;
	return 0;
}

async function fetchUrlBytes(tabId: number, url: string, rangeHeader?: string): Promise<Uint8Array> {
	const headers: Record<string, string> = { ...FETCH_HEADERS };
	if (rangeHeader) headers.Range = rangeHeader;

	const result = await runFetchInTab(tabId, url, { method: 'GET', headers });

	if (!result.ok || !('bytes' in result)) {
		throw httpError(result.ok ? 0 : result.status);
	}

	if (!result.bytes.length) {
		throw new Error('Stream returned empty data.');
	}

	return new Uint8Array(result.bytes);
}

async function fetchTimeRange(
	tabId: number,
	url: string,
	startSec: number,
	endSec: number,
	duration: number
): Promise<Uint8Array> {
	const pad = 4;
	const segStart = Math.max(0, startSec - pad);
	const segEnd = Math.min(duration, endSec + pad);

	try {
		const totalBytes = await fetchContentLength(tabId, url);
		if (totalBytes > 0 && duration > 0) {
			const startByte = Math.floor((segStart / duration) * totalBytes);
			const endByte = Math.min(totalBytes - 1, Math.ceil((segEnd / duration) * totalBytes));
			if (endByte > startByte) {
				return await fetchUrlBytes(tabId, url, `bytes=${startByte}-${endByte}`);
			}
		}
	} catch {
		// Fall through to full fetch.
	}

	return await fetchUrlBytes(tabId, url);
}

export type FetchedTrimStreams = {
	videoData: Uint8Array;
	audioData?: Uint8Array;
	trimStartOffset: number;
};

export async function fetchTrimStreams(
	tabId: number,
	options: {
		streams: StreamUrls;
		start: number;
		end: number;
		duration: number;
	}
): Promise<FetchedTrimStreams> {
	const { streams, start, end, duration } = options;
	const videoUrl = streams.progressiveUrl ?? streams.videoUrl;

	if (!videoUrl) {
		throw new Error('No captured stream — play the video for ~10 seconds, then retry.');
	}

	const pad = 4;
	const segStart = Math.max(0, start - pad);
	const trimStartOffset = start - segStart;

	const videoData = await fetchTimeRange(tabId, videoUrl, start, end, duration);

	let audioData: Uint8Array | undefined;
	if (!streams.progressiveUrl && streams.audioUrl) {
		audioData = await fetchTimeRange(tabId, streams.audioUrl, start, end, duration);
	}

	return { videoData, audioData, trimStartOffset };
}