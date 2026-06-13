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
	videoUrl: string;
	audioUrl?: string;
	start: number;
	end: number;
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
	blobUrl: string;
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

async function fetchStream(url: string, onProgress: (percent: number) => void): Promise<Uint8Array> {
	const response = await fetch(url, {
		headers: { Referer: 'https://www.youtube.com/', Origin: 'https://www.youtube.com' },
	});
	if (!response.ok) {
		throw new Error(`Failed to download stream (${response.status})`);
	}

	const reader = response.body?.getReader();
	if (!reader) {
		return new Uint8Array(await response.arrayBuffer());
	}

	const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
	const chunks: Uint8Array[] = [];
	let received = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		if (contentLength > 0) {
			onProgress(Math.min(99, Math.round((received / contentLength) * 100)));
		}
	}

	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	}
	return merged;
}

async function runFfmpeg(ff: FFmpeg, args: string[]) {
	await ff.exec(args);
	const output = await ff.readFile('output.mp4');
	return new Blob([output], { type: 'video/mp4; codecs="avc1.640028, mp4a.40.2"' });
}

async function cleanupFiles(ff: FFmpeg, files: string[]) {
	for (const file of files) {
		try {
			await ff.deleteFile(file);
		} catch {
			// ignore missing temp files
		}
	}
}

async function processTrimJob(job: TrimJob) {
	const { jobId, videoUrl, audioUrl, start, end, mode } = job;
	const duration = Math.max(0.1, end - start);
	const tempFiles = ['output.mp4'];

	try {
		post({ type: 'TRIM_PROGRESS', jobId, phase: 'downloading', percent: 0, message: 'Downloading video…' });

		const videoData = await fetchStream(videoUrl, (percent) => {
			post({ type: 'TRIM_PROGRESS', jobId, phase: 'downloading', percent, message: `Downloading… ${percent}%` });
		});

		let audioData: Uint8Array | null = null;
		if (audioUrl) {
			audioData = await fetchStream(audioUrl, (percent) => {
				post({
					type: 'TRIM_PROGRESS',
					jobId,
					phase: 'downloading',
					percent,
					message: `Downloading audio… ${percent}%`,
				});
			});
		}

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
			start,
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
		const blobUrl = URL.createObjectURL(blob);

		await cleanupFiles(ff, tempFiles);

		post({ type: 'TRIM_COMPLETE', jobId, blobUrl });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Trim failed';
		post({ type: 'TRIM_ERROR', jobId, error: message });
	}
}

async function processTranscodeBlobJob(job: TranscodeBlobJob) {
	const { jobId, mimeType, buffer } = job;
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
		const blobUrl = URL.createObjectURL(blob);

		await cleanupFiles(ff, tempFiles);

		post({ type: 'TRIM_COMPLETE', jobId, blobUrl });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Transcode failed';
		post({ type: 'TRIM_ERROR', jobId, error: message });
	}
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type === 'TRIM_JOB') {
		processTrimJob(message as TrimJob);
		sendResponse({ ok: true });
	}

	if (message?.type === 'TRANSCODE_BLOB_JOB') {
		processTranscodeBlobJob(message as TranscodeBlobJob);
		sendResponse({ ok: true });
	}

	return true;
});