import type {
	ExportTranscodeRequest,
	ExportTrimRequest,
	ExportTrimProgress,
	ExportTrimResult,
	FetchTrimStreamsResponse,
	StreamUrls,
} from '../messaging';

type PendingJob = {
	tabId: number;
	filename: string;
};

const pendingJobs = new Map<string, PendingJob>();

function resolveTrimMode(streams: StreamUrls): 'progressive' | 'adaptive' | 'video-only' {
	if (streams.progressiveUrl) return 'progressive';
	if (streams.audioUrl) return 'adaptive';
	return 'video-only';
}

function buildTrimFilename(title: string, start: number, end: number): string {
	return `${sanitizeFilename(title)} (${formatTime(start)}-${formatTime(end)}).mp4`;
}

function sendProgress(tabId: number, progress: ExportTrimProgress) {
	chrome.tabs.sendMessage(tabId, progress).catch(() => {});
}

function sendResult(tabId: number, result: ExportTrimResult) {
	chrome.tabs.sendMessage(tabId, result).catch(() => {});
}

function isValidStreamUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.length > 0;
	} catch {
		return false;
	}
}

function sanitizeFilename(title: string): string {
	return title.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 80) || 'youtube-clip';
}

function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}h${m.toString().padStart(2, '0')}m${s.toString().padStart(2, '0')}s`;
	return `${m}m${s.toString().padStart(2, '0')}s`;
}

async function ensureOffscreenDocument() {
	const hasDoc = await chrome.offscreen.hasDocument();
	if (hasDoc) return;

	await chrome.offscreen.createDocument({
		url: chrome.runtime.getURL('src/offscreen/index.html'),
		reasons: [chrome.offscreen.Reason.WORKERS],
		justification: 'Process and trim downloaded YouTube video segments',
	});
}

export function initExportListener() {
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message?.type === 'TRIM_PROGRESS') {
			const job = pendingJobs.get(message.jobId);
			if (job) {
				sendProgress(job.tabId, {
					type: 'EXPORT_TRIM_PROGRESS',
					phase: message.phase,
					percent: message.percent,
					message: message.message,
				});
			}
			return;
		}

		if (message?.type === 'TRIM_COMPLETE') {
			const job = pendingJobs.get(message.jobId);
			if (!job) return;

			const bytes = message.data instanceof Uint8Array ? message.data : new Uint8Array(message.data ?? []);
			if (!bytes.byteLength) {
				sendResult(job.tabId, {
					type: 'EXPORT_TRIM_RESULT',
					success: false,
					error: 'Export produced an empty file.',
				});
				pendingJobs.delete(message.jobId);
				return;
			}

			const blob = new Blob([bytes], { type: 'video/mp4' });
			const blobUrl = URL.createObjectURL(blob);

			sendProgress(job.tabId, {
				type: 'EXPORT_TRIM_PROGRESS',
				phase: 'saving',
				percent: 100,
				message: 'Saving file…',
			});

			chrome.downloads.download({ url: blobUrl, filename: job.filename, saveAs: true }, (downloadId) => {
				const error = chrome.runtime.lastError;
				if (error || downloadId === undefined) {
					sendResult(job.tabId, {
						type: 'EXPORT_TRIM_RESULT',
						success: false,
						error: error?.message ?? 'Download failed',
					});
				} else {
					sendResult(job.tabId, { type: 'EXPORT_TRIM_RESULT', success: true });
				}
				pendingJobs.delete(message.jobId);
				setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
			});
			return;
		}

		if (message?.type === 'TRIM_ERROR') {
			const job = pendingJobs.get(message.jobId);
			if (job) {
				sendResult(job.tabId, {
					type: 'EXPORT_TRIM_RESULT',
					success: false,
					error: message.error,
				});
				pendingJobs.delete(message.jobId);
			}
			return;
		}
	});
}

export async function handleExportTrim(request: ExportTrimRequest): Promise<ExportTrimResult> {
	const { title, range, streams } = request;
	const tabId = request.tabId;
	const start = Math.max(0, range.start);
	const end = Math.max(start + 0.1, range.end);

	if (!tabId) {
		return {
			type: 'EXPORT_TRIM_RESULT',
			success: false,
			error: 'Could not determine the active YouTube tab.',
		};
	}

	const streamUrl = streams.progressiveUrl ?? streams.videoUrl;
	if (!streamUrl || !isValidStreamUrl(streamUrl)) {
		return {
			type: 'EXPORT_TRIM_RESULT',
			success: false,
			error: 'No video stream available — refresh the page, play the video briefly, then retry.',
		};
	}

	if (streams.audioUrl && !isValidStreamUrl(streams.audioUrl)) {
		streams.audioUrl = undefined;
	}

	try {
		sendProgress(tabId, {
			type: 'EXPORT_TRIM_PROGRESS',
			phase: 'downloading',
			percent: 0,
			message: 'Downloading stream from YouTube…',
		});

		const fetched = (await chrome.tabs.sendMessage(tabId, {
			type: 'FETCH_TRIM_STREAMS',
			start,
			end,
			duration: request.duration,
			streams,
		})) as FetchTrimStreamsResponse | undefined;

		if (!fetched?.ok || !fetched.videoData?.byteLength) {
			return {
				type: 'EXPORT_TRIM_RESULT',
				success: false,
				error:
					fetched?.error ??
					'Could not download stream — play the video for ~10 seconds, then retry Trim & Download.',
			};
		}

		await ensureOffscreenDocument();

		const jobId = crypto.randomUUID();
		pendingJobs.set(jobId, { tabId, filename: buildTrimFilename(title, start, end) });

		sendProgress(tabId, {
			type: 'EXPORT_TRIM_PROGRESS',
			phase: 'trimming',
			percent: 0,
			message: 'Encoding clip…',
		});

		await chrome.runtime.sendMessage({
			type: 'TRIM_JOB',
			jobId,
			videoData: fetched.videoData,
			audioData: fetched.audioData,
			trimStartOffset: fetched.trimStartOffset ?? start,
			duration: end - start,
			mode: resolveTrimMode(streams),
		});

		return { type: 'EXPORT_TRIM_RESULT', success: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Export failed';
		return { type: 'EXPORT_TRIM_RESULT', success: false, error: message };
	}
}

export async function handleExportTranscode(request: ExportTranscodeRequest): Promise<ExportTrimResult> {
	const tabId = request.tabId;

	if (!tabId) {
		return {
			type: 'EXPORT_TRIM_RESULT',
			success: false,
			error: 'Could not determine the active YouTube tab.',
		};
	}

	try {
		await ensureOffscreenDocument();

		const jobId = crypto.randomUUID();
		const filename = request.filename.endsWith('.mp4') ? request.filename : `${request.filename}.mp4`;
		pendingJobs.set(jobId, { tabId, filename });

		sendProgress(tabId, {
			type: 'EXPORT_TRIM_PROGRESS',
			phase: 'trimming',
			percent: 0,
			message: 'Encoding web-friendly MP4…',
		});

		await chrome.runtime.sendMessage({
			type: 'TRANSCODE_BLOB_JOB',
			jobId,
			mimeType: request.mimeType,
			buffer: new Uint8Array(request.buffer),
		});

		return { type: 'EXPORT_TRIM_RESULT', success: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Transcode failed';
		return { type: 'EXPORT_TRIM_RESULT', success: false, error: message };
	}
}