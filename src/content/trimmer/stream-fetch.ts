import type { StreamUrls } from '../../messaging';

const FETCH_HEADERS = {
	Referer: 'https://www.youtube.com/',
	Origin: 'https://www.youtube.com',
};

type PageFetchPayload =
	| { channel: string; ok: true; bytes: Uint8Array }
	| { channel: string; ok: true; contentLength: number }
	| { channel: string; ok: false; status?: number; error: string };

function runInPage<T extends PageFetchPayload>(scriptBody: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const channel = `yt-clipper-fetch-${crypto.randomUUID()}`;
		const timeout = window.setTimeout(() => {
			window.removeEventListener(channel, onResult);
			reject(new Error('Stream fetch timed out — try playing the video again.'));
		}, 180_000);

		const onResult = (event: Event) => {
			const detail = (event as CustomEvent<T>).detail;
			if (detail?.channel !== channel) return;
			window.removeEventListener(channel, onResult);
			clearTimeout(timeout);
			resolve(detail);
		};

		window.addEventListener(channel, onResult);

		const script = document.createElement('script');
		script.textContent = `(async () => { const channel = ${JSON.stringify(channel)}; ${scriptBody} })();`;
		(document.head || document.documentElement).appendChild(script);
		script.remove();
	});
}

async function fetchContentLength(url: string): Promise<number> {
	const result = await runInPage<PageFetchPayload>(`
		try {
			const res = await fetch(${JSON.stringify(url)}, {
				method: 'HEAD',
				headers: ${JSON.stringify(FETCH_HEADERS)},
				credentials: 'include',
			});
			if (!res.ok) {
				window.dispatchEvent(new CustomEvent(channel, {
					detail: { channel, ok: false, status: res.status, error: 'HTTP ' + res.status }
				}));
				return;
			}
			const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10);
			window.dispatchEvent(new CustomEvent(channel, {
				detail: { channel, ok: true, contentLength }
			}));
		} catch (error) {
			window.dispatchEvent(new CustomEvent(channel, {
				detail: { channel, ok: false, error: error instanceof Error ? error.message : 'HEAD failed' }
			}));
		}
	`);

	if (!result.ok) return 0;
	if ('contentLength' in result) return result.contentLength;
	return 0;
}

async function fetchUrlBytes(url: string, rangeHeader?: string): Promise<Uint8Array> {
	const headers: Record<string, string> = { ...FETCH_HEADERS };
	if (rangeHeader) headers.Range = rangeHeader;

	const result = await runInPage<PageFetchPayload>(`
		try {
			const res = await fetch(${JSON.stringify(url)}, {
				method: 'GET',
				headers: ${JSON.stringify(headers)},
				credentials: 'include',
			});
			if (!res.ok) {
				window.dispatchEvent(new CustomEvent(channel, {
					detail: { channel, ok: false, status: res.status, error: 'HTTP ' + res.status }
				}));
				return;
			}
			const ab = await res.arrayBuffer();
			window.dispatchEvent(new CustomEvent(channel, {
				detail: { channel, ok: true, bytes: new Uint8Array(ab) }
			}));
		} catch (error) {
			window.dispatchEvent(new CustomEvent(channel, {
				detail: { channel, ok: false, error: error instanceof Error ? error.message : 'Fetch failed' }
			}));
		}
	`);

	if (!result.ok || !('bytes' in result)) {
		const hint =
			result.ok === false && result.status === 403
				? 'Stream blocked (403) — play the video for ~10 seconds, then retry Trim & Download.'
				: result.ok === false
					? result.error
					: 'Stream returned no data.';
		throw new Error(hint);
	}

	if (!result.bytes.byteLength) {
		throw new Error('Stream returned empty data.');
	}

	return result.bytes;
}

async function fetchTimeRange(url: string, startSec: number, endSec: number, duration: number): Promise<Uint8Array> {
	const pad = 4;
	const segStart = Math.max(0, startSec - pad);
	const segEnd = Math.min(duration, endSec + pad);

	try {
		const totalBytes = await fetchContentLength(url);
		if (totalBytes > 0 && duration > 0) {
			const startByte = Math.floor((segStart / duration) * totalBytes);
			const endByte = Math.min(totalBytes - 1, Math.ceil((segEnd / duration) * totalBytes));
			if (endByte > startByte) {
				return await fetchUrlBytes(url, `bytes=${startByte}-${endByte}`);
			}
		}
	} catch {
		// Fall through to full fetch.
	}

	return await fetchUrlBytes(url);
}

export type FetchedTrimStreams = {
	videoData: Uint8Array;
	audioData?: Uint8Array;
	trimStartOffset: number;
};

export async function fetchTrimStreams(options: {
	streams: StreamUrls;
	start: number;
	end: number;
	duration: number;
	onProgress?: (message: string) => void;
}): Promise<FetchedTrimStreams> {
	const { streams, start, end, duration } = options;
	const videoUrl = streams.progressiveUrl ?? streams.videoUrl;

	if (!videoUrl) {
		throw new Error('No captured stream — play the video for ~10 seconds, then retry.');
	}

	const pad = 4;
	const segStart = Math.max(0, start - pad);
	const trimStartOffset = start - segStart;

	options.onProgress?.('Downloading video stream…');
	const videoData = await fetchTimeRange(videoUrl, start, end, duration);

	let audioData: Uint8Array | undefined;
	if (!streams.progressiveUrl && streams.audioUrl) {
		options.onProgress?.('Downloading audio stream…');
		audioData = await fetchTimeRange(streams.audioUrl, start, end, duration);
	}

	return { videoData, audioData, trimStartOffset };
}