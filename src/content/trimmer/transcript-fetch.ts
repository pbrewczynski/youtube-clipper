const LOG_PREFIX = '[YT Clipper · Transcript]';

type CaptionTrack = {
	baseUrl?: string;
	languageCode?: string;
	name?: { simpleText?: string };
	kind?: string;
	vssId?: string;
	isTranslatable?: boolean;
};

type RawSegment = { start: number; duration: number; text: string };

export type TranscriptLoadResult = {
	segments: RawSegment[] | null;
	failureReason: string | null;
	source: 'timedtext' | 'innertube' | 'dom' | null;
};

function logTranscript(stage: string, details: Record<string, unknown>, level: 'log' | 'warn' | 'error' = 'log') {
	const payload = { stage, ...details };
	console[level](LOG_PREFIX, payload);
}

function summarizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const params = [...parsed.searchParams.entries()].map(([key, value]) => {
			if (key === 'signature' || key === 'sig' || key === 'pot') {
				return `${key}=${value.slice(0, 8)}…`;
			}
			if (value.length > 48) return `${key}=${value.slice(0, 24)}…`;
			return `${key}=${value}`;
		});
		return `${parsed.origin}${parsed.pathname}?${params.join('&')}`;
	} catch {
		return url.slice(0, 120);
	}
}

function describeTrack(track: CaptionTrack, index: number): string {
	const name = track.name?.simpleText ?? 'unknown';
	const kind = track.kind === 'asr' ? 'auto-generated' : track.kind ? track.kind : 'manual';
	return `#${index} ${track.languageCode ?? '?'} (${kind}, ${name})`;
}

function buildCaptionUrl(baseUrl: string, fmt: string): string {
	const url = new URL(baseUrl);
	url.searchParams.set('fmt', fmt);
	return url.toString();
}

function parseJson3Captions(data: { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> }): RawSegment[] {
	const segments: RawSegment[] = [];
	for (const event of data.events ?? []) {
		if (!event.segs?.length) continue;
		const text = event.segs
			.map((seg) => seg.utf8 ?? '')
			.join('')
			.replace(/\n/g, ' ')
			.trim();
		if (!text) continue;
		segments.push({
			start: (event.tStartMs ?? 0) / 1000,
			duration: (event.dDurationMs ?? 0) / 1000,
			text,
		});
	}
	return segments;
}

function parseSrv3Captions(xml: string): RawSegment[] {
	const segments: RawSegment[] = [];
	const pattern = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(xml)) !== null) {
		const text = match[3]
			.replace(/<[^>]+>/g, '')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&#39;/g, "'")
			.replace(/&quot;/g, '"')
			.trim();
		if (!text) continue;
		segments.push({
			start: Number.parseFloat(match[1]),
			duration: Number.parseFloat(match[2]),
			text,
		});
	}
	return segments;
}

function rankCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
	const score = (track: CaptionTrack) => {
		let value = 0;
		if (track.languageCode === 'en') value += 20;
		if (!track.kind) value += 10;
		if (track.kind === 'asr') value += 5;
		if (track.baseUrl) value += 1;
		return value;
	};
	return [...tracks].sort((a, b) => score(b) - score(a));
}

async function fetchCaptionBody(
	track: CaptionTrack,
	fmt: string,
): Promise<{ ok: boolean; status: number; contentType: string; text: string; url: string }> {
	const url = buildCaptionUrl(track.baseUrl!, fmt);
	const res = await fetch(url, {
		credentials: 'same-origin',
		headers: { 'Accept-Language': navigator.language || 'en-US,en;q=0.9' },
	});
	const text = await res.text();
	return {
		ok: res.ok,
		status: res.status,
		contentType: res.headers.get('content-type') ?? 'unknown',
		text,
		url,
	};
}

async function fetchTimedTextSegments(
	playerResponse: Record<string, unknown> | null,
): Promise<{ segments: RawSegment[] | null; failureReason: string | null }> {
	if (!playerResponse) {
		const reason = 'No player response found on the page (ytInitialPlayerResponse missing).';
		logTranscript('player-response-missing', { reason }, 'warn');
		return { segments: null, failureReason: reason };
	}

	const captionTracks = (playerResponse as {
		captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
	}).captions?.playerCaptionsTracklistRenderer?.captionTracks;

	if (!captionTracks?.length) {
		const reason = 'This video has no caption tracks in the player response.';
		logTranscript('no-caption-tracks', {
			reason,
			hint: 'The uploader may not have provided captions, or YouTube has not exposed them yet.',
		}, 'warn');
		return { segments: null, failureReason: reason };
	}

	logTranscript('caption-tracks-discovered', {
		count: captionTracks.length,
		tracks: captionTracks.map((track, index) => describeTrack(track, index)),
	});

	const formats = ['json3', 'srv3', 'vtt'] as const;
	const attempts: Array<Record<string, unknown>> = [];

	for (const [index, track] of rankCaptionTracks(captionTracks).entries()) {
		if (!track.baseUrl) {
			attempts.push({
				track: describeTrack(track, index),
				error: 'Track has no baseUrl',
			});
			continue;
		}

		for (const fmt of formats) {
			try {
				const response = await fetchCaptionBody(track, fmt);
				const bodyPreview = response.text.trim().slice(0, 160);
				const attempt: Record<string, unknown> = {
					track: describeTrack(track, index),
					fmt,
					status: response.status,
					ok: response.ok,
					contentType: response.contentType,
					bodyLength: response.text.length,
					url: summarizeUrl(response.url),
				};

				if (!response.ok) {
					attempt.error = `HTTP ${response.status}`;
					attempts.push(attempt);
					continue;
				}

				if (!response.text.trim()) {
					attempt.error = 'Empty response body';
					attempt.possibleCauses = [
						'Caption URL signature or poToken may be stale',
						'Track exists in metadata but is not downloadable yet',
						'YouTube timedtext endpoint rejected this client/session',
					];
					attempts.push(attempt);
					continue;
				}

				let segments: RawSegment[] = [];
				if (fmt === 'json3') {
					try {
						const data = JSON.parse(response.text) as Parameters<typeof parseJson3Captions>[0];
						if (!data.events?.length) {
							attempt.error = 'JSON parsed but contained no caption events';
							attempt.bodyPreview = bodyPreview;
							attempts.push(attempt);
							continue;
						}
						segments = parseJson3Captions(data);
					} catch (parseErr) {
						attempt.error = 'Failed to parse json3 payload';
						attempt.parseError = parseErr instanceof Error ? parseErr.message : String(parseErr);
						attempt.bodyPreview = bodyPreview;
						attempts.push(attempt);
						continue;
					}
				} else if (fmt === 'srv3') {
					segments = parseSrv3Captions(response.text);
					if (!segments.length) {
						attempt.error = 'srv3 XML parsed but contained no <text> nodes';
						attempt.bodyPreview = bodyPreview;
						attempts.push(attempt);
						continue;
					}
				} else {
					attempt.error = 'VTT fallback not implemented yet';
					attempts.push(attempt);
					continue;
				}

				if (!segments.length) {
					attempt.error = 'Parsed caption payload but all lines were empty';
					attempts.push(attempt);
					continue;
				}

				logTranscript('timedtext-success', {
					track: describeTrack(track, index),
					fmt,
					segmentCount: segments.length,
					url: summarizeUrl(response.url),
				});
				return { segments, failureReason: null };
			} catch (error) {
				attempts.push({
					track: describeTrack(track, index),
					fmt,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	const reason = 'Timedtext API returned no usable captions for any track/format.';
	logTranscript('timedtext-failed', {
		reason,
		attempts,
		nextStep: 'Will try opening YouTube transcript panel and scraping DOM as fallback.',
	}, 'warn');
	return { segments: null, failureReason: reason };
}

function getInnertubeClientVersion(): string {
	const config = (window as unknown as { ytcfg?: { data_?: { INNERTUBE_CLIENT_VERSION?: string } } }).ytcfg?.data_;
	return config?.INNERTUBE_CLIENT_VERSION ?? '2.20260612.01.00';
}

async function fetchInnertubeTranscript(videoId: string): Promise<RawSegment[] | null> {
	const params =
		(document.querySelector('ytd-video-description-transcript-section-renderer') as HTMLElement | null)
			?.dataset?.params ??
		(document.querySelector('[target-id="engagement-panel-searchable-transcript"]') as HTMLElement | null)
			?.getAttribute('params');

	if (!params) {
		logTranscript('innertube-skipped', {
			reason: 'No get_transcript params found in page DOM',
			videoId,
			hint: 'Open the YouTube “Show transcript” panel once, then reopen the trimmer.',
		});
		return null;
	}

	try {
		const res = await fetch('/youtubei/v1/get_transcript?prettyPrint=false', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				context: {
					client: {
						clientName: 'WEB',
						clientVersion: getInnertubeClientVersion(),
						hl: document.documentElement.lang || 'en',
					},
				},
				params,
			}),
		});

		const text = await res.text();
		if (!res.ok || !text.trim()) {
			logTranscript('innertube-failed', {
				status: res.status,
				bodyLength: text.length,
				videoId,
				bodyPreview: text.trim().slice(0, 160),
			}, 'warn');
			return null;
		}

		const data = JSON.parse(text) as {
			actions?: Array<{
				updateEngagementPanelAction?: {
					content?: {
						transcriptRenderer?: {
							body?: {
								transcriptBodyRenderer?: {
									cueGroups?: Array<{
										transcriptCueGroupRenderer?: {
											cues?: Array<{
												transcriptCueRenderer?: {
													cue?: { simpleText?: string };
													startOffsetMs?: number;
													durationMs?: number;
												};
											}>;
										};
									}>;
								};
							};
						};
					};
				};
			}>;
		};

		const cueGroups =
			data.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.body
				?.transcriptBodyRenderer?.cueGroups ?? [];

		const segments: RawSegment[] = [];
		for (const group of cueGroups) {
			for (const cue of group.transcriptCueGroupRenderer?.cues ?? []) {
				const renderer = cue.transcriptCueRenderer;
				const textValue = renderer?.cue?.simpleText?.trim();
				if (!textValue) continue;
				segments.push({
					start: (renderer?.startOffsetMs ?? 0) / 1000,
					duration: (renderer?.durationMs ?? 0) / 1000,
					text: textValue,
				});
			}
		}

		if (!segments.length) {
			logTranscript('innertube-empty', { videoId, reason: 'Response parsed but cue list was empty' }, 'warn');
			return null;
		}

		logTranscript('innertube-success', { videoId, segmentCount: segments.length });
		return segments;
	} catch (error) {
		logTranscript('innertube-error', {
			videoId,
			error: error instanceof Error ? error.message : String(error),
		}, 'warn');
		return null;
	}
}

async function openTranscriptPanel(): Promise<boolean> {
	const selectors = [
		'ytd-video-description-transcript-section-renderer button',
		'button[aria-label*="transcript" i]',
		'button[aria-label*="Transcript" i]',
	];
	for (const selector of selectors) {
		const button = document.querySelector(selector) as HTMLButtonElement | null;
		if (!button) continue;
		button.click();
		logTranscript('opened-transcript-panel', { selector });
		await new Promise((resolve) => setTimeout(resolve, 700));
		return true;
	}
	logTranscript('transcript-panel-button-missing', {
		reason: 'Could not find a “Show transcript” button on the page',
	});
	return false;
}

function scrapeTranscriptFromDom(): { segments: RawSegment[] | null; failureReason: string | null } {
	const segElements = document.querySelectorAll('ytd-transcript-segment-renderer, .transcript-segment');
	if (!segElements.length) {
		const reason = 'Transcript panel is not open and no transcript segments were found in the DOM.';
		logTranscript('dom-scrape-empty', {
			reason,
			hint: 'Click “Show transcript” under the video description, then reopen the trimmer.',
		}, 'warn');
		return { segments: null, failureReason: reason };
	}

	const findTime = (el: HTMLElement): number | null => {
		const timeStr = el.querySelector('.segment-timestamp, #timestamp')?.textContent?.trim();
		if (!timeStr) return null;
		const parts = timeStr.split(':').map(Number);
		if (parts.length === 2) return parts[0] * 60 + parts[1];
		if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
		return null;
	};

	const segments: RawSegment[] = [];
	segElements.forEach((el) => {
		const start = findTime(el as HTMLElement);
		if (start === null) return;
		const text = el.querySelector('.segment-text, #text')?.textContent?.trim() || '';
		if (!text) return;
		segments.push({ start, duration: 0, text });
	});

	if (!segments.length) {
		const reason = 'Transcript elements were present, but timestamps/text could not be parsed.';
		logTranscript('dom-scrape-unparsed', { reason, elementCount: segElements.length }, 'warn');
		return { segments: null, failureReason: reason };
	}

	logTranscript('dom-scrape-success', { segmentCount: segments.length });
	return { segments, failureReason: null };
}

export async function loadVideoTranscript(
	playerResponse: Record<string, unknown> | null,
	videoId: string,
): Promise<TranscriptLoadResult> {
	logTranscript('load-start', { videoId });

	const timedText = await fetchTimedTextSegments(playerResponse);
	if (timedText.segments?.length) {
		return { segments: timedText.segments, failureReason: null, source: 'timedtext' };
	}

	const innertubeSegments = await fetchInnertubeTranscript(videoId);
	if (innertubeSegments?.length) {
		return { segments: innertubeSegments, failureReason: null, source: 'innertube' };
	}

	let domResult = scrapeTranscriptFromDom();
	if (!domResult.segments?.length) {
		await openTranscriptPanel();
		domResult = scrapeTranscriptFromDom();
	}

	if (domResult.segments?.length) {
		return { segments: domResult.segments, failureReason: null, source: 'dom' };
	}

	const failureReason =
		domResult.failureReason ??
		timedText.failureReason ??
		'Transcript could not be loaded from timedtext, innertube, or DOM.';

	logTranscript('load-failed', { videoId, failureReason }, 'warn');
	return { segments: null, failureReason, source: null };
}