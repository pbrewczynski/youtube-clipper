import type { TrimRange } from '../../messaging';

export async function recordSelection(range: TrimRange, onProgress: (message: string) => void): Promise<Blob> {
	const video = document.querySelector('video');
	if (!video) throw new Error('Video element not found');

	const candidates = [
		'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
		'video/mp4;codecs=avc1,mp4a',
		'video/mp4;codecs=avc1',
		'video/mp4',
		'video/webm;codecs=vp9,opus',
		'video/webm;codecs=vp8,opus',
		'video/webm',
	];
	const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';

	const stream = video.captureStream();
	const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
	const chunks: Blob[] = [];

	recorder.ondataavailable = (event) => {
		if (event.data.size > 0) chunks.push(event.data);
	};

	const duration = range.end - range.start;

	return new Promise((resolve, reject) => {
		let stopped = false;
		const finish = () => {
			if (stopped) return;
			stopped = true;
			video.pause();
			if (recorder.state !== 'inactive') recorder.stop();
		};

		recorder.onerror = () => reject(new Error('Recording failed'));
		recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));

		const startRecording = () => {
			onProgress(`Recording ${Math.ceil(duration)}s — keep this tab visible and unmuted…`);
			try {
				recorder.start(250);
			} catch {
				reject(new Error('Could not start recorder — try refreshing the page'));
				return;
			}

			video.muted = false;
			video.volume = Math.max(video.volume, 0.5);
			video.play().catch(() => reject(new Error('Could not play video — click the video once, then retry')));

			const tick = () => {
				if (stopped) return;
				if (video.currentTime >= range.end - 0.05) {
					finish();
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		};

		video.pause();
		video.currentTime = range.start;
		if (Math.abs(video.currentTime - range.start) < 0.1) {
			startRecording();
		} else {
			video.addEventListener('seeked', startRecording, { once: true });
		}
	});
}