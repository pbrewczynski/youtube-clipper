export type TrimEncodeMode = 'progressive' | 'adaptive' | 'video-only';

const FASTSTART = ['-movflags', '+faststart'];

export const FRIENDLY_VIDEO_ARGS = [
	'-c:v',
	'libx264',
	'-preset',
	'fast',
	'-crf',
	'20',
	'-profile:v',
	'high',
	'-level',
	'4.0',
	'-pix_fmt',
	'yuv420p',
	'-tag:v',
	'avc1',
];

export const FRIENDLY_AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000'];

export function buildTrimFfmpegArgs(options: {
	mode: TrimEncodeMode;
	start: number;
	duration: number;
	hasAudioTrack: boolean;
}): { inputFiles: string[]; args: string[] } {
	const { mode, start, duration, hasAudioTrack } = options;
	const ss = String(start);
	const t = String(duration);

	if (mode === 'progressive') {
		return {
			inputFiles: ['input.mp4'],
			args: ['-ss', ss, '-t', t, '-i', 'input.mp4', '-c', 'copy', ...FASTSTART, 'output.mp4'],
		};
	}

	if (mode === 'adaptive' && hasAudioTrack) {
		return {
			inputFiles: ['input.video', 'input.audio'],
			args: [
				'-ss',
				ss,
				'-t',
				t,
				'-i',
				'input.video',
				'-ss',
				ss,
				'-t',
				t,
				'-i',
				'input.audio',
				'-map',
				'0:v:0',
				'-map',
				'1:a:0',
				...FRIENDLY_VIDEO_ARGS,
				...FRIENDLY_AUDIO_ARGS,
				...FASTSTART,
				'output.mp4',
			],
		};
	}

	return {
		inputFiles: ['input.video'],
		args: [
			'-ss',
			ss,
			'-t',
			t,
			'-i',
			'input.video',
			'-map',
			'0:v:0',
			...FRIENDLY_VIDEO_ARGS,
			'-an',
			...FASTSTART,
			'output.mp4',
		],
	};
}

export function buildTranscodeFfmpegArgs(mimeType: string): { inputFile: string; args: string[] } {
	const isMp4 = mimeType.includes('mp4');
	const inputFile = isMp4 ? 'input.mp4' : 'input.webm';

	if (isMp4) {
		return {
			inputFile,
			args: ['-i', inputFile, '-c', 'copy', ...FASTSTART, 'output.mp4'],
		};
	}

	return {
		inputFile,
		args: ['-i', inputFile, ...FRIENDLY_VIDEO_ARGS, ...FRIENDLY_AUDIO_ARGS, ...FASTSTART, 'output.mp4'],
	};
}