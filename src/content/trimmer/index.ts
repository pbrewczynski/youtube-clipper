import { trimmerOverlay } from './trimmer-overlay';
import type { ContentMessage } from '../../messaging';
import { stopClipPlayback } from '../clip-playback';

export function initTrimmer() {
	chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
		if (message.type === 'SHOW_TRIMMER') {
			stopClipPlayback();
			trimmerOverlay.show();
			sendResponse({ ok: true });
			return;
		}

		if (message.type === 'HIDE_TRIMMER') {
			trimmerOverlay.hide();
			sendResponse({ ok: true });
			return;
		}

		if (message.type === 'GET_TRIMMER_STATE') {
			sendResponse({
				type: 'TRIMMER_STATE',
				...trimmerOverlay.getState(),
			});
			return;
		}

		if (message.type === 'SET_TRIMMER_RANGE') {
			trimmerOverlay.setRange(message.range);
			sendResponse({ ok: true });
			return;
		}
	});

	injectClipButton();
}

function injectClipButton() {
	let playerObserver: MutationObserver | null = null;

	const tryInject = () => {
		const controls = document.querySelector('.ytp-right-controls');
		if (!controls || controls.querySelector('.yt-clipper-btn')) return false;

		const btn = document.createElement('button');
		btn.className = 'ytp-button yt-clipper-btn';
		btn.title = 'Trim & Download';
		btn.innerHTML = `
			<svg height="100%" viewBox="0 0 36 36" width="100%">
				<path fill="#fff" d="M9 8h12a1 1 0 0 1 1 1v3.5l4-2.5v11l-4-2.5V26a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zm2 2v16h8V10H11zm10 4.8l2.5 1.6V15.6L21 17.2V12.8z"/>
			</svg>
		`;
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			stopClipPlayback();
			trimmerOverlay.show();
		});

		controls.insertBefore(btn, controls.firstChild);
		return true;
	};

	const watchPlayer = () => {
		const player = document.querySelector('#movie_player, .html5-video-player');
		if (!player) return false;

		tryInject();
		playerObserver?.disconnect();
		playerObserver = new MutationObserver(tryInject);
		playerObserver.observe(player, { childList: true, subtree: true });
		return true;
	};

	if (!watchPlayer()) {
		const bootObserver = new MutationObserver(() => {
			if (watchPlayer()) bootObserver.disconnect();
		});
		bootObserver.observe(document.body, { childList: true, subtree: false });
	}
}