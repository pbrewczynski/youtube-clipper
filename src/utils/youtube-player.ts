export type StoryboardInfo = {
	baseUrl: string;
	level: number;
	width: number;
	height: number;
	count: number;
	interval: number;
	cols: number;
	rows: number;
};

export type PlayerFormat = {
	url?: string;
	mimeType?: string;
	qualityLabel?: string;
	height?: number;
	itag?: number;
	bitrate?: number;
};

export type AdaptiveStreamUrls = {
	progressiveUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
};

export function getVideoIdFromUrl(url: string): string | null {
	const match = url.match(/[?&]v=([^&#]+)/) ?? url.match(/\/shorts\/([^/?&#]+)/);
	return match?.[1] ?? null;
}

export function getPlayerResponse(): Record<string, unknown> | null {
	const win = window as unknown as Record<string, unknown>;
	if (win.ytInitialPlayerResponse) {
		return win.ytInitialPlayerResponse as Record<string, unknown>;
	}

	// In content scripts, we often can't access window.ytInitialPlayerResponse directly.
	// We look for the script tag that defines it.
	const scripts = document.querySelectorAll('script');
	for (const script of scripts) {
		const text = script.textContent || '';
		if (text.includes('ytInitialPlayerResponse = ')) {
			try {
				const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
				if (match) {
					return JSON.parse(match[1]) as Record<string, unknown>;
				}
				// Fallback for cases where it might not end with a semicolon or is assigned differently
				const startIdx = text.indexOf('ytInitialPlayerResponse = ') + 'ytInitialPlayerResponse = '.length;
				let bracketCount = 0;
				let endIdx = -1;
				for (let i = startIdx; i < text.length; i++) {
					if (text[i] === '{') bracketCount++;
					else if (text[i] === '}') {
						bracketCount--;
						if (bracketCount === 0) {
							endIdx = i + 1;
							break;
						}
					}
				}
				if (endIdx !== -1) {
					return JSON.parse(text.slice(startIdx, endIdx)) as Record<string, unknown>;
				}
			} catch {
				// ignore parse errors
			}
		}
	}

	const configEl = document.querySelector('script.yt-player-config');
	if (configEl?.textContent) {
		try {
			const config = JSON.parse(configEl.textContent) as {
				args?: { player_response?: string };
			};
			if (config.args?.player_response) {
				return JSON.parse(config.args.player_response) as Record<string, unknown>;
			}
		} catch {
			// ignore parse errors
		}
	}

	return null;
}

export function getVideoTitle(playerResponse?: Record<string, unknown> | null): string {
	const response = playerResponse ?? getPlayerResponse();
	const details = response?.videoDetails as { title?: string } | undefined;
	return details?.title ?? document.title.replace(' - YouTube', '');
}

export function getVideoDuration(playerResponse?: Record<string, unknown> | null): number {
	const response = playerResponse ?? getPlayerResponse();
	const details = response?.videoDetails as { lengthSeconds?: string } | undefined;
	const fromPlayer = parseFloat(details?.lengthSeconds ?? '0');
	if (fromPlayer > 0) return fromPlayer;

	const video = document.querySelector('video');
	return video?.duration && Number.isFinite(video.duration) ? video.duration : 0;
}

export function getProgressiveFormatUrl(playerResponse?: Record<string, unknown> | null): string | undefined {
	const response = playerResponse ?? getPlayerResponse();
	const streamingData = response?.streamingData as
		| { formats?: PlayerFormat[]; adaptiveFormats?: PlayerFormat[] }
		| undefined;

	const progressive = (streamingData?.formats ?? [])
		.filter((f) => f.url && f.mimeType?.includes('video/mp4'))
		.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

	if (progressive[0]?.url) return progressive[0].url;

	const combined = (streamingData?.adaptiveFormats ?? [])
		.filter((f) => f.url && f.mimeType?.includes('video/mp4') && f.mimeType.includes('mp4a'))
		.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

	return combined[0]?.url;
}

export function getAdaptiveStreamUrls(playerResponse?: Record<string, unknown> | null): AdaptiveStreamUrls {
	const response = playerResponse ?? getPlayerResponse();
	const streamingData = response?.streamingData as
		| { formats?: PlayerFormat[]; adaptiveFormats?: PlayerFormat[] }
		| undefined;

	const adaptive = streamingData?.adaptiveFormats ?? [];

	const video = adaptive
		.filter((f) => f.url && f.mimeType?.includes('video/'))
		.sort((a, b) => {
			const aMp4 = a.mimeType?.includes('video/mp4') ? 1 : 0;
			const bMp4 = b.mimeType?.includes('video/mp4') ? 1 : 0;
			if (bMp4 !== aMp4) return bMp4 - aMp4;
			return (b.height ?? 0) - (a.height ?? 0);
		})[0];

	const audio = adaptive
		.filter((f) => f.url && f.mimeType?.includes('audio/'))
		.sort((a, b) => {
			const aAac = a.mimeType?.includes('audio/mp4') || a.mimeType?.includes('mp4a') ? 1 : 0;
			const bAac = b.mimeType?.includes('audio/mp4') || b.mimeType?.includes('mp4a') ? 1 : 0;
			if (bAac !== aAac) return bAac - aAac;
			return (b.bitrate ?? 0) - (a.bitrate ?? 0);
		})[0];

	return {
		progressiveUrl: getProgressiveFormatUrl(response),
		videoUrl: video?.url,
		audioUrl: audio?.url,
	};
}

function replaceQueryParam(url: string, param: string, newValue: string): string {
	try {
		const u = new URL(url);
		u.searchParams.set(param, newValue);
		return u.toString();
	} catch {
		const regex = new RegExp(`([?&])${param}=[^&]*`);
		if (url.match(regex)) {
			return url.replace(regex, `$1${param}=${newValue}`);
		}
		return url + (url.includes('?') ? '&' : '?') + `${param}=${newValue}`;
	}
}

export function parseStoryboard(playerResponse?: Record<string, unknown> | null): StoryboardInfo | null {
	const response = playerResponse ?? getPlayerResponse();
	const spec =
		(
			response?.storyboards as
				| {
						playerStoryboardSpecRenderer?: { spec?: string };
				  }
				| undefined
		)?.playerStoryboardSpecRenderer?.spec ??
		(
			response?.storyboards as
				| {
						playerLiveStoryboardSpecRenderer?: { spec?: string };
				  }
				| undefined
		)?.playerLiveStoryboardSpecRenderer?.spec;

	if (!spec) return null;

	const parts = spec.split('|');
	if (parts.length < 2) return null;

	const urlPart = parts[0];

	// Choose the highest quality level (the last configuration part)
	const levelIndex = parts.length - 1;
	const level = levelIndex - 1;
	const sizePart = parts[levelIndex];
	if (!sizePart) return null;

	const sizeParams = sizePart.split('#');
	const width = parseInt(sizeParams[0], 10) || 160;
	const height = parseInt(sizeParams[1], 10) || 90;
	const count = parseInt(sizeParams[2], 10) || 100;
	const cols = parseInt(sizeParams[3], 10) || 5;
	const rows = parseInt(sizeParams[4], 10) || 5;
	
	let interval = parseInt(sizeParams[5], 10) || 10000;
	if (interval > 100) {
		interval = interval / 1000;
	}

	let baseUrl = urlPart.replace('$L', String(level));
	
	const sigh = sizeParams[7];
	if (sigh) {
		baseUrl = replaceQueryParam(baseUrl, 'sigh', sigh);
	}

	return {
		baseUrl,
		level,
		width,
		height,
		count,
		interval,
		cols,
		rows,
	};
}

export function getStoryboardTileUrl(info: StoryboardInfo, time: number, duration: number): string {
	const framesPerTile = info.cols * info.rows;
	const frameIndex = Math.max(0, Math.floor(time / info.interval));
	const tileIndex = Math.floor(frameIndex / framesPerTile);
	
	const totalTiles = Math.ceil(info.count / framesPerTile);
	const clampedTileIndex = Math.min(totalTiles - 1, Math.max(0, tileIndex));

	return info.baseUrl.replace('$N', String(clampedTileIndex));
}