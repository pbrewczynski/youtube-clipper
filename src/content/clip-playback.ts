import type { ContentStorage } from './local-storage';
import type { IVideo } from '../interfaces/video';

let controller: AbortController | undefined;

export function stopClipPlayback() {
	controller?.abort();
	controller = undefined;
}

export function isClipPlaybackActive() {
	return !!controller;
}

function isValidClip(video: IVideo): boolean {
	if (!video.clips?.length) return false;
	const clip = video.clips[0];
	return clip.end > clip.start + 0.5;
}

export function startClipPlayback(storage: ContentStorage, videoId: string) {
	stopClipPlayback();

	const video = storage.videos[videoId];
	if (!video || !isValidClip(video)) return;

	const videoElement = document.querySelector('video');
	if (!videoElement) return;

	let clipPosition = 0;
	const first = video.clips[0];
	videoElement.currentTime = Math.max(0, first.start);

	const listener = () => {
		const curr = videoElement.currentTime;
		const active = video.clips[clipPosition];
		if (!active || curr < active.end) return;

		clipPosition++;
		if (clipPosition < video.clips.length) {
			videoElement.currentTime = video.clips[clipPosition].start;
			return;
		}

		if (video.loop) {
			clipPosition = 0;
			videoElement.currentTime = video.clips[0].start;
			return;
		}

		videoElement.pause();
		stopClipPlayback();
	};

	videoElement.addEventListener('timeupdate', listener);
	controller = new AbortController();
	controller.signal.onabort = () => {
		videoElement.removeEventListener('timeupdate', listener);
	};
}