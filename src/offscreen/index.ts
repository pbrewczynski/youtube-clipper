import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import {
	buildTranscodeFfmpegArgs,
	buildTrimFfmpegArgs,
	type TrimEncodeMode,
} from './mp4-encode';

type TrimJob = {
	type: 'TRIM_JOB';
	jobId: string;
	videoData: Uint8Array;
	audioData?: Uint8Array;
	trimStartOffset: number;
	duration: number;
	mode: TrimEncodeMode;
};

type TranscodeBlobJob = {
	type: 'TRANSCODE_BLOB_JOB';
	jobId: string;
	mimeType: string;
	buffer: Uint8Array;
};

type TrimProgress = {
	type: 'TRIM_PROGRESS';
	jobId: string;
	phase: 'downloading' | 'trimming' | 'saving';
	percent: number;
	message: string;
};

type TrimComplete = {
	type: 'TRIM_COMPLETE';
	jobId: string;
	data: Uint8Array;
	downloadId?: number;
};

type TrimError = {
	type: 'TRIM_ERROR';
	jobId: string;
	error: string;
};

let ffmpeg: FFmpeg | null = null;
let ffmpegLoading: Promise<void> | null = null;

async function ensureFfmpeg(): Promise<FFmpeg> {
	if (ffmpeg?.loaded) return ffmpeg;

	if (!ffmpegLoading) {
		ffmpegLoading = (async () => {
			const instance = new FFmpeg();
			const base = chrome.runtime.getURL('ffmpeg');
			await instance.load({
				coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
				wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
			});
			ffmpeg = instance;
		})();
	}

	await ffmpegLoading;
	return ffmpeg!;
}

function post(message: TrimProgress | TrimComplete | TrimError) {
	chrome.runtime.sendMessage(message);
}

async function runFfmpeg(ff: FFmpeg, args: string[]) {
	await ff.exec(args);
	const output = await ff.readFile('output.mp4');
	return new Blob([output], { type: 'video/mp4' });
}

async function triggerDownload(blob: Blob, filename: string): Promise<number> {
	console.log(`[triggerDownload] Creating blob URL for ${filename}, size: ${blob.size} bytes`);
	const url = URL.createObjectURL(blob);
	console.log(`[triggerDownload] Blob URL created: ${url}`);
	
	return new Promise<number>((resolve, reject) => {
		console.log(`[triggerDownload] Initiating chrome.downloads.download for ${filename}`);
		chrome.downloads.download(
			{
				url,
				filename,
				saveAs: true,
			},
			(downloadId) => {
				const err = chrome.runtime.lastError;
				if (err || downloadId === undefined) {
					console.error(`[triggerDownload] Download failed to initiate:`, err);
					URL.revokeObjectURL(url);
					reject(new Error(err?.message ?? 'Download failed'));
					return;
				}

				console.log(`[triggerDownload] Download initiated successfully with ID: ${downloadId}`);

				// Safely revoke the URL once the download is finished or interrupted
				const listener = (delta: chrome.downloads.DownloadDelta) => {
					if (delta.id === downloadId && delta.state) {
						console.log(`[triggerDownload] Download ID ${downloadId} state changed to: ${delta.state.current}`);
						if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
							console.log(`[triggerDownload] Revoking blob URL: ${url}`);
							URL.revokeObjectURL(url);
							chrome.downloads.onChanged.removeListener(listener);
						}
					}
				};
				chrome.downloads.onChanged.addListener(listener);
				
				resolve(downloadId);
			}
		);
	});
}

async function cleanupFiles(ff: FFmpeg, files: string[]) {
	for (const file of files) {
		try {
			await ff.deleteFile(file);
		} catch {
			// ignore if not found or delete fails
		}
	}
}

async function processTrimJob(job: TrimJob & { filename: string }) {
	const { jobId, videoData, audioData, trimStartOffset, duration, mode, filename } = job;
	const tempFiles = ['output.mp4'];

	try {
		post({
			type: 'TRIM_PROGRESS',
			jobId,
			phase: 'trimming',
			percent: 0,
			message: mode === 'progressive' ? 'Optimizing MP4 for web & Apple…' : 'Encoding H.264 + AAC…',
		});

		const ff = await ensureFfmpeg();
		const { inputFiles, args } = buildTrimFfmpegArgs({
			mode,
			start: trimStartOffset,
			duration,
			hasAudioTrack: !!audioData,
		});

		if (mode === 'progressive') {
			await ff.writeFile('input.mp4', videoData);
		} else {
			await ff.writeFile('input.video', videoData);
			if (audioData) await ff.writeFile('input.audio', audioData);
		}

		tempFiles.push(...inputFiles);

		const blob = await runFfmpeg(ff, args);
		const downloadId = await triggerDownload(blob, filename);

		await cleanupFiles(ff, tempFiles);

		post({ type: 'TRIM_COMPLETE', jobId, data: new Uint8Array(), downloadId }); // Send empty data since we downloaded it
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Trim failed';
		post({ type: 'TRIM_ERROR', jobId, error: message });
	}
}

async function processTranscodeBlobJob(job: TranscodeBlobJob & { filename: string }) {
	const { jobId, mimeType, buffer, filename } = job;
	const tempFiles = ['output.mp4'];

	try {
		post({
			type: 'TRIM_PROGRESS',
			jobId,
			phase: 'trimming',
			percent: 0,
			message: mimeType.includes('mp4') ? 'Optimizing MP4 for web & Apple…' : 'Encoding H.264 + AAC…',
		});

		const ff = await ensureFfmpeg();
		const { inputFile, args } = buildTranscodeFfmpegArgs(mimeType);
		await ff.writeFile(inputFile, buffer);
		tempFiles.push(inputFile);

		const blob = await runFfmpeg(ff, args);
		const downloadId = await triggerDownload(blob, filename);

		await cleanupFiles(ff, tempFiles);

		post({ type: 'TRIM_COMPLETE', jobId, data: new Uint8Array(), downloadId });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Transcode failed';
		post({ type: 'TRIM_ERROR', jobId, error: message });
	}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type === 'TRIM_JOB') {
		processTrimJob(message as TrimJob & { filename: string });
		sendResponse({ ok: true });
	}

	if (message?.type === 'TRANSCODE_BLOB_JOB') {
		processTranscodeBlobJob(message as TranscodeBlobJob & { filename: string });
		sendResponse({ ok: true });
	}

	if (message?.type === 'DOWNLOAD_FILE') {
		const bytes = message.buffer instanceof Uint8Array ? message.buffer : new Uint8Array(message.buffer);
		const blob = new Blob([bytes], { type: message.mimeType ?? 'video/mp4' });
		triggerDownload(blob, message.filename)
			.then((downloadId) => sendResponse({ success: true, downloadId }))
			.catch((err) => sendResponse({ success: false, error: err.message }));
		return true;
	}

	return true;
});