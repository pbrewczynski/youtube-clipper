import { handleExportTranscode, handleExportTrim, initExportListener } from './export-handler';
import { getCapturedStreams, initStreamCapture, setCapturedStreams } from './stream-capture';
import type { ExportTranscodeRequest, ExportTrimRequest } from '../messaging';

initStreamCapture();
initExportListener();

chrome.commands.onCommand.addListener(async (command) => {
	if (command === 'play-toggle') {
		playToggle();
	}
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type === 'GET_STREAMS') {
		sendResponse(getCapturedStreams(sender.tab?.id ?? -1));
		return;
	}

	if (message?.type === 'REGISTER_STREAMS') {
		if (sender.tab?.id) {
			setCapturedStreams(sender.tab.id, message.streams);
		}
		sendResponse({ ok: true });
		return;
	}

	if (message?.type === 'EXPORT_TRIM') {
		const request = message as ExportTrimRequest;
		if (!request.tabId && sender.tab?.id) {
			request.tabId = sender.tab.id;
		}
		handleExportTrim(request).then(sendResponse);
		return true;
	}

	if (message?.type === 'EXPORT_TRANSCODE') {
		const request = message as ExportTranscodeRequest;
		if (!request.tabId && sender.tab?.id) {
			request.tabId = sender.tab.id;
		}
		handleExportTranscode(request).then(sendResponse);
		return true;
	}

	if (message?.type === 'DOWNLOAD_BLOB') {
		const bytes = new Uint8Array(message.buffer);
		const blob = new Blob([bytes], { type: message.mimeType ?? 'video/webm' });
		const blobUrl = URL.createObjectURL(blob);
		chrome.downloads
			.download({ url: blobUrl, filename: message.filename, saveAs: true })
			.then(() => sendResponse({ success: true }))
			.catch((error: Error) => sendResponse({ success: false, error: error.message }))
			.finally(() => setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000));
		return true;
	}
});

async function playToggle() {
	const tabs = await chrome.tabs.query({});
	for (let i = 0; i < tabs.length; i++) {
		const tab = tabs[i];
		const isYoutubeMusic = !!tab.url?.includes('music.youtube.co');
		if (!isYoutubeMusic && !tab.url?.includes('youtube.com/watch?v=')) continue;

		if (isYoutubeMusic) {
			await chrome.scripting.executeScript({
				func: () => {
					document.dispatchEvent(
						new KeyboardEvent('keydown', {
							key: ' ',
							keyCode: 32,
							which: 32,
							shiftKey: false,
							ctrlKey: false,
							metaKey: false,
						})
					);
				},
				target: { tabId: tab.id! },
			});
			return;
		}

		await chrome.scripting.executeScript({
			func: () => {
				document.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'k',
						keyCode: 75,
						code: 'KeyK',
						which: 75,
						shiftKey: false,
						ctrlKey: false,
						metaKey: false,
					})
				);
			},
			target: { tabId: tab.id! },
		});
		return;
	}
}