import type {
	ExportTranscodeRequest,
	ExportTrimRequest,
	ExportTrimProgress,
	ExportTrimResult,
	StreamUrls,
} from '../messaging';
import { fetchTrimStreams } from './stream-fetch';

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

			sendResult(job.tabId, { type: 'EXPORT_TRIM_RESULT', success: true });
			pendingJobs.delete(message.jobId);
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

async function tryYtDlpBridge(videoId: string, start: number, end: number, filename: string): Promise<boolean> {
	try {
		const response = await fetch('http://localhost:5005/trim', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ videoId, start, end, filename }),
		});
		if (!response.ok) return false;
		const result = await response.json();
		return !!result.success;
	} catch {
		return false;
	}
}

export async function handleExportTrim(request: ExportTrimRequest): Promise<ExportTrimResult> {
	const { title, range, streams, videoId } = request;
	const tabId = request.tabId;
	const start = Math.max(0, range.start);
	const end = Math.max(start + 0.1, range.end);
	const filename = buildTrimFilename(title, start, end);

	if (!tabId) {
		return {
			type: 'EXPORT_TRIM_RESULT',
			success: false,
			error: 'Could not determine the active YouTube tab.',
		};
	}

	// Try local yt-dlp bridge first
	sendProgress(tabId, {
		type: 'EXPORT_TRIM_PROGRESS',
		phase: 'downloading',
		percent: 0,
		message: 'Checking for local yt-dlp bridge…',
	});

	if (await tryYtDlpBridge(videoId, start, end, filename)) {
		sendResult(tabId, { type: 'EXPORT_TRIM_RESULT', success: true });
		return { type: 'EXPORT_TRIM_RESULT', success: true };
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

		let fetched;
		try {
			fetched = await fetchTrimStreams(tabId, {
				streams,
				start,
				end,
				duration: request.duration,
			});
		} catch (error) {
			return {
				type: 'EXPORT_TRIM_RESULT',
				success: false,
				error: error instanceof Error ? error.message : 'Could not download stream.',
			};
		}

		if (!fetched.videoData.byteLength) {
			return {
				type: 'EXPORT_TRIM_RESULT',
				success: false,
				error: 'Could not download stream — play the video for ~10 seconds, then retry Trim & Download.',
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
			filename: job.filename,
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
			filename,
			mimeType: request.mimeType,
			buffer: new Uint8Array(request.buffer),
		});

		return { type: 'EXPORT_TRIM_RESULT', success: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Transcode failed';
		return { type: 'EXPORT_TRIM_RESULT', success: false, error: message };
	}
}