import type { ExportTrimResult, TrimRange } from '../../messaging';
import {
	getVideoDuration,
	getVideoIdFromUrl,
	getVideoTitle,
	hasUsableStreams,
	resolveStreamUrls,
	parseStoryboard,
	getStoryboardTileUrl,
	checkBridgeHealth,
	getPlayerResponse,
} from './trimmer-utils';
import type { StoryboardInfo } from '../../utils/youtube-player';
import { recordSelection } from './record-fallback';
import { stopClipPlayback } from '../clip-playback';
import { loadVideoTranscript } from './transcript-fetch';

type TranscriptSegment = {
	start: number;
	end: number;
	duration: number;
	text: string;
};

const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

.overlay {
	position: fixed;
	inset: 0;
	z-index: 2147483646;
	display: flex;
	align-items: flex-end;
	justify-content: center;
	background: rgba(0, 0, 0, 0.55);
	backdrop-filter: blur(4px);
	font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
	animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
	from { opacity: 0; }
	to { opacity: 1; }
}

.panel {
	width: 100%;
	margin: 0;
	background: linear-gradient(180deg, rgba(38, 38, 40, 0.98) 0%, rgba(28, 28, 30, 0.98) 100%);
	border-top: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 14px 14px 0 0;
	box-shadow: 0 -12px 60px rgba(0, 0, 0, 0.55);
	color: #f5f5f7;
	overflow: hidden;
	transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 14px 18px 10px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.title {
	font-size: 13px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 70%;
	opacity: 0.95;
}

.header-actions {
	display: flex;
	align-items: center;
	gap: 12px;
}

.mode-switcher {
	display: flex;
	background: rgba(0, 0, 0, 0.3);
	padding: 3px;
	border-radius: 8px;
	border: 1px solid rgba(255, 255, 255, 0.1);
}

.mode-btn {
	padding: 5px 12px;
	border-radius: 6px;
	font-size: 11px;
	font-weight: 600;
	cursor: pointer;
	border: none;
	background: transparent;
	color: rgba(255, 255, 255, 0.5);
	transition: all 0.2s;
}

.mode-btn.active {
	background: rgba(255, 255, 255, 0.15);
	color: #fff;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.version-badge {
	font-size: 10px;
	font-family: ui-monospace, monospace;
	opacity: 0.45;
	padding: 2px 6px;
}

.btn {
	border: none;
	border-radius: 8px;
	padding: 7px 14px;
	font-size: 12px;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s, transform 0.1s;
}

.btn:active { transform: scale(0.97); }
.btn-ghost {
	background: rgba(255, 255, 255, 0.08);
	color: #f5f5f7;
}
.btn-ghost:hover { background: rgba(255, 255, 255, 0.14); }
.btn-primary {
	background: #ffd60a;
	color: #1c1c1e;
}
.btn-primary:hover { background: #ffe566; }
.btn-primary:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.preview-area {
	padding: 16px 18px 8px;
}

.time-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 10px;
	font-variant-numeric: tabular-nums;
}

.time-current {
	font-size: 22px;
	font-weight: 600;
	letter-spacing: 0.02em;
}

.time-meta {
	font-size: 12px;
	opacity: 0.65;
}

.timeline-wrap {
	position: relative;
	height: 56px;
	border-radius: 10px;
	overflow: visible;
	background: linear-gradient(180deg, #1c1c1e 0%, #101012 100%);
	border: 1px solid rgba(255, 255, 255, 0.07);
	user-select: none;
	touch-action: none;
	cursor: pointer;
}

.timeline-track {
	position: absolute;
	inset: 0;
	border-radius: inherit;
	overflow: hidden;
	display: flex;
	pointer-events: none;
}

.timeline-thumb {
	flex: 1 0 auto;
	height: 100%;
	background-size: cover;
	background-position: center;
	background-repeat: no-repeat;
	border-right: 1px solid rgba(255, 255, 255, 0.05);
}

.dim-left, .dim-right {
	position: absolute;
	top: 0;
	bottom: 0;
	background: rgba(0, 0, 0, 0.62);
	pointer-events: none;
	z-index: 2;
}

.selection {
	position: absolute;
	top: 0;
	bottom: 0;
	border-top: 3px solid #ffd60a;
	border-bottom: 3px solid #ffd60a;
	background: rgba(255, 214, 10, 0.08);
	z-index: 3;
	pointer-events: none;
	transition: box-shadow 0.15s ease;
}

.selection.dragging {
	box-shadow: inset 0 0 0 1px rgba(255, 214, 10, 0.55);
	background: rgba(255, 214, 10, 0.14);
}

.handle {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 14px;
	background: #ffd60a;
	cursor: ew-resize;
	z-index: 5;
	display: flex;
	align-items: center;
	justify-content: center;
}

.handle::after {
	content: '';
	width: 3px;
	height: 28px;
	border-radius: 2px;
	background: rgba(0, 0, 0, 0.35);
}

.handle-start { border-radius: 4px 0 0 4px; transform: translateX(-100%); }
.handle-end { border-radius: 0 4px 4px 0; }

.playhead {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 0;
	z-index: 6;
	pointer-events: none;
	transform: translateX(-50%);
}

.playhead-line {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	width: 2px;
	background: #fff;
	box-shadow: 0 0 8px rgba(255, 255, 255, 0.75);
}

.playhead-hit {
	position: absolute;
	top: -6px;
	bottom: -6px;
	left: -12px;
	width: 24px;
	cursor: ew-resize;
	pointer-events: auto;
}

.playhead-knob {
	position: absolute;
	top: -7px;
	left: -6px;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: #fff;
	border: 2px solid rgba(0, 0, 0, 0.35);
	box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
	transition: transform 0.12s ease;
}

.thumbnail-preview {
	position: absolute;
	bottom: calc(100% + 12px);
	left: 0;
	transform: translateX(-50%);
	background: #000;
	border: 2px solid #fff;
	border-radius: 4px;
	pointer-events: none;
	opacity: 0;
	transition: opacity 0.1s ease;
	z-index: 10;
	box-shadow: 0 4px 12px rgba(0,0,0,0.5);
	display: flex;
	flex-direction: column;
	align-items: center;
	overflow: hidden;
}

.thumbnail-preview.visible {
	opacity: 1;
}

.thumbnail-image {
	display: block;
	background-color: #222;
	background-repeat: no-repeat;
}

.thumbnail-time {
	position: absolute;
	bottom: 4px;
	background: rgba(0,0,0,0.7);
	color: #fff;
	padding: 2px 6px;
	border-radius: 4px;
	font-size: 11px;
	font-variant-numeric: tabular-nums;
}

.playhead.scrubbing .playhead-knob {
	transform: scale(1.25);
}

.playhead[data-in-selection="true"] .playhead-line {
	background: #ffd60a;
	box-shadow: 0 0 8px rgba(255, 214, 10, 0.65);
}

.playhead[data-in-selection="true"] .playhead-knob {
	background: #ffd60a;
	border-color: rgba(0, 0, 0, 0.45);
}

.controls {
	display: flex;
	align-items: center;
	gap: 16px;
	padding: 12px 18px 16px;
}

.play-btn {
	width: 40px;
	height: 40px;
	border-radius: 50%;
	border: none;
	background: #ffd60a;
	color: #1c1c1e;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background 0.15s, transform 0.1s;
	flex-shrink: 0;
}

.play-btn:hover { background: #ffe566; transform: scale(1.05); }
.play-btn:active { transform: scale(0.95); }

.play-btn.playing svg {
	color: #1c1c1e;
}

.range-labels {
	display: flex;
	gap: 24px;
	font-size: 13px;
	font-variant-numeric: tabular-nums;
	flex: 1;
}

.label-group {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.label-hint {
	font-size: 10px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	opacity: 0.5;
	font-weight: 700;
}

.label-group strong {
	font-weight: 600;
	color: #fff;
}

.shortcuts {
	font-size: 11px;
	opacity: 0.4;
	text-align: right;
	max-width: 200px;
	line-height: 1.4;
}

.status {
	padding: 0 18px 14px;
	font-size: 12px;
	min-height: 18px;
}

.status.error { color: #ff6b6b; }
.status.progress { color: #ffd60a; }
.status.success {
	color: #4cd964;
	display: flex;
	align-items: center;
	font-weight: 500;
}

.progress-bar {
	height: 3px;
	background: rgba(255, 255, 255, 0.1);
	margin: 0 18px 14px;
	border-radius: 2px;
	overflow: hidden;
	display: none;
}

.progress-bar.visible { display: block; }
.progress-fill {
	height: 100%;
	background: #ffd60a;
	width: 0%;
	transition: width 0.2s;
}

.transcript-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
	min-height: 28px;
}

.transcript-toolbar-hint {
	font-size: 11px;
	color: rgba(255, 255, 255, 0.42);
	line-height: 1.3;
}

.transcript-toggle {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 4px;
	border-radius: 999px;
	border: 1px solid rgba(255, 255, 255, 0.1);
	background: rgba(0, 0, 0, 0.28);
	cursor: pointer;
	transition: background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
}

.transcript-toggle:disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.transcript-toggle-label {
	font-size: 11px;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.72);
	padding-right: 4px;
	user-select: none;
}

.transcript-toggle-track {
	position: relative;
	width: 38px;
	height: 22px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.14);
	transition: background 0.2s ease;
}

.transcript-toggle.on .transcript-toggle-track {
	background: rgba(255, 214, 10, 0.35);
}

.transcript-toggle-thumb {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 18px;
	height: 18px;
	border-radius: 50%;
	background: #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
	transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.transcript-toggle.on .transcript-toggle-thumb {
	transform: translateX(16px);
	background: #ffd60a;
}

.transcript-panel {
	display: none;
	flex-direction: column;
	margin-bottom: 12px;
	border-radius: 12px;
	overflow: hidden;
	border: 1px solid rgba(255, 255, 255, 0.08);
	background: linear-gradient(180deg, rgba(18, 18, 20, 0.92) 0%, rgba(10, 10, 12, 0.96) 100%);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
	animation: transcriptReveal 0.24s ease;
}

.transcript-panel.visible {
	display: flex;
}

@keyframes transcriptReveal {
	from {
		opacity: 0;
		transform: translateY(6px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

.transcript-panel-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 12px 6px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.transcript-panel-title {
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: rgba(255, 255, 255, 0.45);
}

.transcript-panel-count {
	font-size: 10px;
	font-variant-numeric: tabular-nums;
	color: rgba(255, 255, 255, 0.35);
}

.transcript-box {
	display: flex;
	flex-direction: column;
	max-height: 132px;
	overflow-y: auto;
	padding: 6px;
	gap: 4px;
	scrollbar-width: thin;
	scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.transcript-box::-webkit-scrollbar {
	width: 5px;
}
.transcript-box::-webkit-scrollbar-thumb {
	background: rgba(255, 255, 255, 0.18);
	border-radius: 3px;
}

.transcript-line {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 10px;
	align-items: start;
	padding: 8px 10px;
	border-radius: 8px;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.72);
	cursor: pointer;
	line-height: 1.45;
	transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
	user-select: none;
	text-align: left;
	border: 1px solid transparent;
	-webkit-tap-highlight-color: transparent;
	touch-action: manipulation;
}

.transcript-line:hover {
	color: #fff;
	background: rgba(255, 255, 255, 0.06);
	border-color: rgba(255, 255, 255, 0.08);
}

.transcript-line.active {
	color: #fff;
	background: rgba(255, 255, 255, 0.05);
	border-color: rgba(255, 255, 255, 0.1);
}

.transcript-line.active .transcript-line-time {
	color: #ffd60a;
}

.transcript-line.in-selection {
	background: rgba(255, 214, 10, 0.08);
	border-color: rgba(255, 214, 10, 0.22);
}

.transcript-line.picked {
	background: rgba(255, 214, 10, 0.16);
	border-color: rgba(255, 214, 10, 0.45);
	box-shadow: 0 0 0 1px rgba(255, 214, 10, 0.12);
	color: #fff;
}

.transcript-line.picked .transcript-line-time {
	color: #ffd60a;
}

.transcript-line-time {
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 10px;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.42);
	flex-shrink: 0;
	padding-top: 1px;
	white-space: nowrap;
}

.transcript-line-text {
	word-break: break-word;
}

.transcript-empty {
	padding: 14px 12px;
	font-size: 12px;
	color: rgba(255, 255, 255, 0.45);
	text-align: center;
}
`;

function finalizeTranscriptSegments(
	segments: Array<{ start: number; duration: number; text: string }>,
	duration: number,
): TranscriptSegment[] {
	return segments.map((seg, index) => {
		const nextStart = segments[index + 1]?.start;
		const inferredEnd = nextStart ?? (seg.duration > 0 ? seg.start + seg.duration : seg.start + 3);
		const end = Math.min(duration > 0 ? duration : inferredEnd, Math.max(inferredEnd, seg.start + 0.5));
		return {
			start: seg.start,
			end,
			duration: Math.max(0.5, end - seg.start),
			text: seg.text,
		};
	});
}

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const pad = (n: number) => n.toString().padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export class TrimmerOverlay {
	private host: HTMLElement | null = null;
	private shadow: ShadowRoot | null = null;
	private video: HTMLVideoElement | null = null;
	private duration = 0;
	private currentTime = 0;
	private range: TrimRange = { start: 0, end: 0 };
	private visible = false;
	private exporting = false;
	private previewing = false;
	private dragTarget: 'start' | 'end' | 'playhead' | 'selection' | null = null;
	private dragStartX = 0;
	private dragStartRange: TrimRange = { start: 0, end: 0 };
	private streamsReady = false;
	private exportListener: ((message: { type?: string }) => void) | null = null;
	private rafId = 0;
	private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
	private storyboardInfo: StoryboardInfo | null = null;
	private exportMode: 'bridge' | 'playback' = 'bridge';
	private transcriptObserver: MutationObserver | null = null;
	private transcriptSegments: TranscriptSegment[] | null = null;
	private activeTranscriptIndex = -1;
	private pickedTranscriptIndex = -1;
	private showTranscript = false;
	private transcriptAvailable = false;
	private transcriptFailureReason: string | null = null;

	private onVideoPlay = () => {
		this.previewing = true;
		this.updatePlayBtn();
	};

	private onVideoPause = () => {
		this.previewing = false;
		this.updatePlayBtn();
	};

	private els: Record<string, HTMLElement> = {};

	show() {
		if (this.visible) return;
		stopClipPlayback();
		this.init();
		this.visible = true;
		this.host!.style.display = 'flex';
		this.syncFromVideo();
		this.populateTimeline();
		this.seekTo(this.range.start);
		this.updateUI();
		this.startPlayheadLoop();
		void this.refreshStreamStatus();
		this.initTranscriptSync();
		void this.loadTranscript();

		this.video?.addEventListener('play', this.onVideoPlay);
		this.video?.addEventListener('pause', this.onVideoPause);

		this.video?.addEventListener(
			'loadedmetadata',
			() => {
				this.syncFromVideo();
				this.populateTimeline();
				this.updateUI();
			},
			{ once: true }
		);
	}

	private initTranscriptSync() {
		if (this.transcriptObserver) return;

		const findTime = (el: HTMLElement): number | null => {
			const timeStr = el.querySelector('.segment-timestamp, #timestamp')?.textContent?.trim();
			if (!timeStr) return null;
			const parts = timeStr.split(':').map(Number);
			if (parts.length === 2) return parts[0] * 60 + parts[1];
			if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
			return null;
		};

		const handleTranscriptClick = (e: MouseEvent) => {
			if (!this.visible) return;
			const segment = (e.target as HTMLElement).closest('ytd-transcript-segment-renderer, .transcript-segment');
			if (!segment) return;

			const time = findTime(segment as HTMLElement);
			if (time === null) return;

			// If user is holding shift, set Out point, else set In point
			if (e.shiftKey) {
				this.range.end = Math.min(this.duration, Math.max(time + 2, this.range.start + 0.5));
			} else {
				this.range.start = Math.max(0, Math.min(time, this.range.end - 0.5));
				this.seekTo(this.range.start);
			}
			this.updateUI();
		};

		// Global listener for transcript clicks (they are often deep in the DOM)
		document.addEventListener('click', handleTranscriptClick, true);

		// Also look for selection-based transcript trimming
		this.transcriptObserver = new MutationObserver(() => {
			const transcript = document.querySelector('ytd-transcript-renderer');
			if (!transcript) return;
			
			// Add a hint to segments
			transcript.querySelectorAll('ytd-transcript-segment-renderer').forEach(seg => {
				(seg as HTMLElement).title = 'Click to set Start, Shift+Click to set End';
			});
		});

		const sidePanel = document.querySelector('#secondary');
		if (sidePanel) {
			this.transcriptObserver.observe(sidePanel, { childList: true, subtree: true });
		}
	}

	private updateTranscriptToggleUI() {
		const toggle = this.els['transcript-toggle'] as HTMLButtonElement | undefined;
		const hint = this.els['transcript-toolbar-hint'] as HTMLElement | undefined;
		const panel = this.els['transcript-panel'] as HTMLElement | undefined;
		const count = this.els['transcript-count'] as HTMLElement | undefined;

		if (!toggle || !hint || !panel) return;

		toggle.classList.toggle('on', this.showTranscript);
		toggle.disabled = !this.transcriptAvailable;
		panel.classList.toggle('visible', this.showTranscript && this.transcriptAvailable);

		if (count) {
			count.textContent = this.transcriptSegments?.length
				? `${this.transcriptSegments.length} lines`
				: '';
		}

		if (!this.transcriptAvailable) {
			hint.textContent = this.transcriptFailureReason ?? 'No transcript available for this video';
			hint.title = this.transcriptFailureReason ?? '';
			return;
		}

		hint.title = '';

		hint.textContent = this.showTranscript
			? 'Tap a line to set In and Out to that caption'
			: 'Show transcript to pick a clip by caption';
	}

	private updateTranscriptHighlights() {
		if (!this.transcriptSegments || !this.showTranscript) return;

		const lines = this.els['transcript-box']?.children;
		if (!lines) return;

		for (let i = 0; i < this.transcriptSegments.length; i++) {
			const line = lines[i] as HTMLElement | undefined;
			const seg = this.transcriptSegments[i];
			if (!line) continue;

			const overlapsSelection = seg.start < this.range.end && seg.end > this.range.start;
			line.classList.toggle('in-selection', overlapsSelection);
			line.classList.toggle('picked', i === this.pickedTranscriptIndex);
		}
	}

	private applyTranscriptLine(index: number) {
		if (!this.transcriptSegments || index < 0 || index >= this.transcriptSegments.length) return;

		const seg = this.transcriptSegments[index];
		this.pickedTranscriptIndex = index;
		this.range.start = Math.max(0, seg.start);
		this.range.end = Math.min(
			this.duration || seg.end,
			Math.max(seg.end, this.range.start + 0.5),
		);
		this.seekTo(this.range.start);
		this.updateUI();
	}

	private async loadTranscript() {
		this.transcriptSegments = null;
		this.activeTranscriptIndex = -1;
		this.pickedTranscriptIndex = -1;
		this.transcriptAvailable = false;
		this.transcriptFailureReason = null;
		this.els['transcript-box'].innerHTML = '';
		this.updateTranscriptToggleUI();

		const videoId = getVideoIdFromUrl(window.location.href) ?? '';
		const result = await loadVideoTranscript(getPlayerResponse(), videoId);
		const segments = result.segments
			? finalizeTranscriptSegments(result.segments, this.duration)
			: null;

		if (!segments?.length) {
			this.transcriptFailureReason = result.failureReason;
		}

		if (segments && segments.length > 0) {
			this.transcriptSegments = segments;
			this.transcriptAvailable = true;

			const fragment = document.createDocumentFragment();
			segments.forEach((seg, index) => {
				const line = document.createElement('div');
				line.className = 'transcript-line';
				line.dataset.index = String(index);
				line.dataset.start = String(seg.start);
				line.dataset.end = String(seg.end);
				line.title = `${formatTime(seg.start)} – ${formatTime(seg.end)}`;
				
				const timeSpan = document.createElement('span');
				timeSpan.className = 'transcript-line-time';
				timeSpan.textContent = `${formatTime(seg.start)}–${formatTime(seg.end)}`;
				
				const textSpan = document.createElement('span');
				textSpan.className = 'transcript-line-text';
				textSpan.textContent = seg.text;
				
				line.appendChild(timeSpan);
				line.appendChild(textSpan);
				fragment.appendChild(line);
			});

			this.els['transcript-box'].appendChild(fragment);
		}

		this.updateTranscriptToggleUI();
		this.updateTranscriptHighlights();
	}

	private populateTimeline() {
		const track = this.els.timeline.querySelector('.timeline-track') as HTMLElement;
		if (!track) return;
		track.innerHTML = '';

		if (!this.storyboardInfo || this.duration <= 0) {
			track.style.background = 'repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.04) 0, rgba(255, 255, 255, 0.04) 1px, transparent 1px, transparent 48px)';
			return;
		}

		track.style.background = 'none';
		const info = this.storyboardInfo;
		const trackRect = this.els.timeline.getBoundingClientRect();
		const trackWidth = trackRect.width || window.innerWidth;
		const thumbHeight = 56;
		const thumbWidth = thumbHeight * (info.width / info.height);
		const count = Math.ceil(trackWidth / thumbWidth) + 1; // Add one extra for overlap safety

		for (let i = 0; i < count; i++) {
			const time = Math.min(this.duration, ((i * thumbWidth) / trackWidth) * this.duration);
			const url = getStoryboardTileUrl(info, time, this.duration);
			const thumb = document.createElement('div');
			thumb.className = 'timeline-thumb';
			thumb.style.width = `${thumbWidth}px`;
			
			const totalIntervals = info.count;
			const intervalDuration = Math.max(info.interval, this.duration / totalIntervals);
			const currentInterval = Math.max(0, Math.floor(time / intervalDuration));
			const cols = info.cols;
			const rows = info.rows;
			const indexInTile = currentInterval % (cols * rows);
			const col = indexInTile % cols;
			const row = Math.floor(indexInTile / cols);

			const colPercent = cols > 1 ? (col / (cols - 1)) * 100 : 0;
			const rowPercent = rows > 1 ? (row / (rows - 1)) * 100 : 0;

			thumb.style.backgroundImage = `url("${url}")`;
			thumb.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
			thumb.style.backgroundPosition = `${colPercent}% ${rowPercent}%`;
			
			track.appendChild(thumb);
		}
	}

	hide() {
		this.visible = false;
		if (this.host) this.host.style.display = 'none';
		this.stopPreview();
		this.clearExportListener();
		cancelAnimationFrame(this.rafId);
		this.video?.removeEventListener('play', this.onVideoPlay);
		this.video?.removeEventListener('pause', this.onVideoPause);
	}

	isVisible() {
		return this.visible;
	}

	getState() {
		return {
			visible: this.visible,
			duration: this.duration,
			currentTime: this.currentTime,
			range: { ...this.range },
			title: getVideoTitle(),
			videoId: getVideoIdFromUrl(window.location.href) ?? '',
		};
	}

	setRange(range: TrimRange) {
		this.range = {
			start: Math.max(0, Math.min(range.start, this.duration)),
			end: Math.max(0, Math.min(range.end, this.duration)),
		};
		if (this.range.end <= this.range.start) {
			this.range.end = Math.min(this.duration, this.range.start + 1);
		}
		this.seekTo(this.range.start);
		this.updateUI();
	}

	private init() {
		if (this.host) return;

		this.video = document.querySelector('video');
		this.duration = getVideoDuration();
		this.currentTime = this.video?.currentTime ?? 0;
		this.range = {
			start: 0,
			end: Math.min(30, this.duration || 30),
		};
		this.storyboardInfo = parseStoryboard();

		this.host = document.createElement('div');
		this.host.id = 'yt-clipper-trimmer';
		this.shadow = this.host.attachShadow({ mode: 'closed' });

		const style = document.createElement('style');
		style.textContent = STYLES;
		this.shadow.appendChild(style);

		const overlay = document.createElement('div');
		overlay.className = 'overlay';
		overlay.innerHTML = `
			<div class="panel">
				<div class="header">
					<div class="title"></div>
					<div class="header-actions">
						<div class="mode-switcher" data-el="mode-switcher">
							<button class="mode-btn ${this.exportMode === 'bridge' ? 'active' : ''}" data-mode="bridge" title="Instant download via local yt-dlp bridge">Bridge</button>
							<button class="mode-btn ${this.exportMode === 'playback' ? 'active' : ''}" data-mode="playback" title="Record fragment from browser playback">Playback</button>
						</div>
						<span class="version-badge" data-el="version"></span>
						<button class="btn btn-ghost" data-action="cancel">Cancel</button>
						<button class="btn btn-primary" data-action="export">Trim & Download</button>
					</div>
				</div>
				<div class="preview-area">
					<div class="time-row">
						<div class="time-current">0:00</div>
						<div class="time-meta">Duration: <span data-el="clip-duration">0:00</span></div>
					</div>
					<div class="transcript-toolbar">
						<div class="transcript-toolbar-hint" data-el="transcript-toolbar-hint">Loading transcript…</div>
						<button class="transcript-toggle" data-action="toggle-transcript" data-el="transcript-toggle" type="button" disabled>
							<span class="transcript-toggle-label">Transcript</span>
							<span class="transcript-toggle-track">
								<span class="transcript-toggle-thumb"></span>
							</span>
						</button>
					</div>
					<div class="transcript-panel" data-el="transcript-panel">
						<div class="transcript-panel-header">
							<span class="transcript-panel-title">Captions</span>
							<span class="transcript-panel-count" data-el="transcript-count"></span>
						</div>
						<div class="transcript-box" data-el="transcript-box"></div>
					</div>
					<div class="timeline-wrap" data-el="timeline">
						<div class="timeline-track"></div>
						<div class="selection" data-el="selection"></div>
						<div class="dim-left" data-el="dim-left"></div>
						<div class="dim-right" data-el="dim-right"></div>
						<div class="handle handle-start" data-el="handle-start"></div>
						<div class="handle handle-end" data-el="handle-end"></div>
						<div class="playhead" data-el="playhead">
							<div class="playhead-hit" data-el="playhead-hit"></div>
							<div class="playhead-line"></div>
							<div class="playhead-knob"></div>
						</div>
						<div class="thumbnail-preview" data-el="thumbnail-preview">
							<div class="thumbnail-image" data-el="thumbnail-image"></div>
							<div class="thumbnail-time" data-el="thumbnail-time">0:00</div>
						</div>
					</div>
				</div>
				<div class="controls">
					<button class="play-btn" data-action="play-selection" title="Play selection">
						<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
							<path d="M8 5v14l11-7z"/>
						</svg>
					</button>
					<div class="range-labels">
						<div class="label-group">
							<span class="label-hint">In</span>
							<strong data-el="in-label">0:00</strong>
						</div>
						<div class="label-group">
							<span class="label-hint">Out</span>
							<strong data-el="out-label">0:00</strong>
						</div>
					</div>
					<div class="shortcuts">Click to scrub · Shift+drag to move selection · I / O · Space</div>
				</div>
				<div class="progress-bar" data-el="progress-bar"><div class="progress-fill" data-el="progress-fill"></div></div>
				<div class="status" data-el="status"></div>
			</div>
		`;

		this.shadow.appendChild(overlay);

		overlay.querySelectorAll('[data-el]').forEach((el) => {
			const key = (el as HTMLElement).dataset.el!;
			this.els[key] = el as HTMLElement;
		});
		this.els.title = overlay.querySelector('.title') as HTMLElement;
		this.els.version = overlay.querySelector('[data-el="version"]') as HTMLElement;
		this.els.version.textContent = `v${chrome.runtime.getManifest().version}`;
		this.els.exportBtn = overlay.querySelector('[data-action="export"]') as HTMLElement;
		this.els.timeCurrent = overlay.querySelector('.time-current') as HTMLElement;
		this.els.timeline = this.els.timeline;

		this.els['transcript-box'].addEventListener('click', (e) => {
			const line = (e.target as HTMLElement).closest('.transcript-line') as HTMLElement;
			if (!line) return;
			e.stopPropagation();
			const index = Number.parseInt(line.dataset.index || '-1', 10);
			this.applyTranscriptLine(index);
		});

		overlay.addEventListener('click', (e) => {
			const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
			if (target) {
				const action = target.dataset.action;
				if (action === 'cancel') this.hide();
				if (action === 'export') this.export();
				if (action === 'play-selection') this.togglePreview();
				if (action === 'toggle-transcript' && this.transcriptAvailable) {
					this.showTranscript = !this.showTranscript;
					this.updateTranscriptToggleUI();
					this.updateTranscriptHighlights();
				}
				return;
			}

			const modeBtn = (e.target as HTMLElement).closest('[data-mode]') as HTMLElement | null;
			if (modeBtn) {
				const mode = modeBtn.dataset.mode as 'bridge' | 'playback';
				this.exportMode = mode;
				this.shadow?.querySelectorAll('.mode-btn').forEach(btn => {
					btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
				});
				this.refreshStreamStatus();
			}
		});

		overlay.addEventListener('mousedown', (e) => {
			if (e.target !== overlay) e.stopPropagation();
			this.onPointerDown(e.clientX, e.target as HTMLElement, e.shiftKey);
		});
		overlay.addEventListener('touchstart', (e) => {
			if (e.target !== overlay) e.stopPropagation();
			const touch = e.touches[0];
			this.onPointerDown(touch.clientX, e.target as HTMLElement, e.shiftKey);
		}, { passive: true });

		const onMove = (clientX: number, target?: HTMLElement) => this.onPointerMove(clientX, target);
		const onUp = () => this.onPointerUp();

		window.addEventListener('mousemove', (e) => onMove(e.clientX, e.target as HTMLElement));
		window.addEventListener('mouseup', onUp);
		window.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.target as HTMLElement), { passive: true });
		window.addEventListener('touchend', onUp);

		window.addEventListener('resize', () => {
			if (this.visible) {
				this.populateTimeline();
				this.updateUI();
			}
		});

		this.onKeyDown = (e: KeyboardEvent) => {
			if (!this.visible) return;
			if (e.target instanceof HTMLInputElement) return;

			if (e.key === 'Escape') {
				this.hide();
			} else if (e.key === ' ' || e.code === 'Space') {
				e.preventDefault();
				this.togglePreview();
			} else if (e.key === 'i' || e.key === 'I') {
				this.range.start = Math.min(this.currentTime, this.range.end - 0.5);
				this.seekTo(this.range.start);
				this.updateUI();
			} else if (e.key === 'o' || e.key === 'O') {
				this.range.end = Math.max(this.currentTime, this.range.start + 0.5);
				this.seekTo(this.range.end);
				this.updateUI();
			} else if (e.key === 'ArrowLeft') {
				this.nudge(e.shiftKey ? -1 : -0.1);
			} else if (e.key === 'ArrowRight') {
				this.nudge(e.shiftKey ? 1 : 0.1);
			}
		};
		document.addEventListener('keydown', this.onKeyDown);

		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) this.hide();
		});

		document.body.appendChild(this.host);
		this.host.style.display = 'none';
	}

	private syncFromVideo() {
		this.video = document.querySelector('video');
		this.duration = getVideoDuration() || this.video?.duration || 0;
		if (this.duration > 0 && this.range.end > this.duration) {
			this.range.end = this.duration;
		}
		this.els.title.textContent = getVideoTitle();
	}

	private timeToPercent(time: number): number {
		if (this.duration <= 0) return 0;
		return (time / this.duration) * 100;
	}

	private percentToTime(percent: number): number {
		return (percent / 100) * this.duration;
	}

	private onPointerDown(clientX: number, target: HTMLElement, shiftKey = false) {
		const timeline = this.els.timeline;
		const rect = timeline.getBoundingClientRect();

		if (target.closest('[data-el="handle-start"]')) {
			this.beginDrag('start');
			return;
		}

		if (target.closest('[data-el="handle-end"]')) {
			this.beginDrag('end');
			return;
		}

		if (!target.closest('[data-el="timeline"]') && !target.closest('[data-el="playhead-hit"]')) {
			return;
		}

		const x = clientX - rect.left;
		const percent = (x / rect.width) * 100;
		const time = this.percentToTime(percent);
		const handleThreshold = Math.max(0.4, this.duration * 0.025);
		const startDist = Math.abs(time - this.range.start);
		const endDist = Math.abs(time - this.range.end);

		if (startDist < endDist && startDist < handleThreshold) {
			this.beginDrag('start');
			return;
		}

		if (endDist < handleThreshold) {
			this.beginDrag('end');
			return;
		}

		if (
			shiftKey &&
			time >= this.range.start &&
			time <= this.range.end
		) {
			this.beginDrag('selection', clientX);
			return;
		}

		this.beginPlayheadScrub(time);
	}

	private beginPlayheadScrub(time: number) {
		this.stopPreview();
		this.dragTarget = 'playhead';
		this.els.playhead.classList.add('scrubbing');
		this.els.timeline.style.cursor = 'ew-resize';
		this.seekTo(time);
		this.updateUI();
	}

	private beginDrag(target: 'start' | 'end' | 'selection', clientX = 0) {
		this.stopPreview();
		this.dragTarget = target;
		this.dragStartX = clientX;
		this.dragStartRange = { ...this.range };
		this.els.selection.classList.add('dragging');
	}

	private onPointerMove(clientX: number, target?: HTMLElement) {
		const rect = this.els.timeline.getBoundingClientRect();
		const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
		const time = this.percentToTime(percent);

		// Handle hover thumbnail
		const isHoveringTimeline = target && (this.els.timeline.contains(target) || target === this.els.timeline);
		if ((isHoveringTimeline || this.dragTarget) && clientX >= rect.left && clientX <= rect.right) {
			this.updateThumbnail(percent, time);
		} else {
			this.els['thumbnail-preview'].classList.remove('visible');
		}

		if (!this.dragTarget) return;

		if (this.dragTarget === 'start') {
			this.range.start = Math.max(0, Math.min(time, this.range.end - 0.5));
			this.seekTo(this.range.start);
		} else if (this.dragTarget === 'end') {
			this.range.end = Math.min(this.duration, Math.max(time, this.range.start + 0.5));
			this.seekTo(this.range.end);
		} else if (this.dragTarget === 'selection') {
			const delta = clientX - this.dragStartX;
			const deltaTime = this.percentToTime((delta / rect.width) * 100);
			const len = this.dragStartRange.end - this.dragStartRange.start;
			let newStart = this.dragStartRange.start + deltaTime;
			newStart = Math.max(0, Math.min(newStart, this.duration - len));
			this.range = { start: newStart, end: newStart + len };
			this.seekTo(this.range.start);
		} else if (this.dragTarget === 'playhead') {
			this.seekTo(time);
		}

		this.updateUI();
	}

	private updateThumbnail(percent: number, time: number) {
		const preview = this.els['thumbnail-preview'];
		const image = this.els['thumbnail-image'];
		const timeLabel = this.els['thumbnail-time'];

		preview.style.left = `${percent}%`;
		timeLabel.textContent = formatTime(time);

		if (this.storyboardInfo) {
			const info = this.storyboardInfo;
			const url = getStoryboardTileUrl(info, time, this.duration);
			
			// A tile image contains multiple thumbnails in a grid.
			// Calculate the correct offset for the current time.
			const totalIntervals = info.count;
			const intervalDuration = Math.max(info.interval, this.duration / totalIntervals);
			const currentInterval = Math.max(0, Math.floor(time / intervalDuration));
			
			// Number of thumbnails per tile image
			const cols = info.cols;
			const rows = info.rows;
			const indexInTile = currentInterval % (cols * rows);
			const col = indexInTile % cols;
			const row = Math.floor(indexInTile / cols);

			const colPercent = cols > 1 ? (col / (cols - 1)) * 100 : 0;
			const rowPercent = rows > 1 ? (row / (rows - 1)) * 100 : 0;

			image.style.width = `${info.width}px`;
			image.style.height = `${info.height}px`;
			image.style.backgroundImage = `url("${url}")`;
			image.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
			image.style.backgroundPosition = `${colPercent}% ${rowPercent}%`;
			
			// Adjust dimensions if it's the last thumbnail which might not be full width
			preview.style.width = `${info.width}px`;
		} else {
			// Fallback if no storyboard is available
			image.style.width = '160px';
			image.style.height = '90px';
			image.style.background = '#222';
		}

		preview.classList.add('visible');
	}

	private onPointerUp() {
		if (!this.dragTarget) return;

		if (this.dragTarget === 'selection') {
			this.seekTo(this.range.start);
		} else if (this.dragTarget === 'start') {
			this.seekTo(this.range.start);
		} else if (this.dragTarget === 'end') {
			this.seekTo(this.range.end);
		}

		this.els.selection.classList.remove('dragging');
		this.els.playhead.classList.remove('scrubbing');
		this.els.timeline.style.cursor = 'pointer';
		this.dragTarget = null;
	}

	private seekTo(time: number, pause = true) {
		if (!this.video) return;
		const clamped = Math.max(0, Math.min(time, this.duration));
		if (pause && !this.video.paused) {
			this.video.pause();
			this.previewing = false;
		}
		this.video.currentTime = clamped;
		this.currentTime = clamped;
	}

	private nudge(delta: number) {
		this.seekTo(this.currentTime + delta);
		this.updateUI();
	}

	private updateUI() {
		const startPct = this.timeToPercent(this.range.start);
		const endPct = this.timeToPercent(this.range.end);
		const playPct = this.timeToPercent(this.currentTime);

		this.els['dim-left'].style.width = `${startPct}%`;
		this.els['dim-right'].style.left = `${endPct}%`;
		this.els['dim-right'].style.width = `${100 - endPct}%`;
		this.els.selection.style.left = `${startPct}%`;
		this.els.selection.style.width = `${endPct - startPct}%`;
		this.els['handle-start'].style.left = `${startPct}%`;
		this.els['handle-end'].style.left = `${endPct}%`;
		this.els.playhead.style.left = `${playPct}%`;
		this.els.playhead.dataset.inSelection =
			this.currentTime >= this.range.start && this.currentTime <= this.range.end ? 'true' : 'false';

		this.els['in-label'].textContent = formatTime(this.range.start);
		this.els['out-label'].textContent = formatTime(this.range.end);
		this.els['clip-duration'].textContent = formatTime(this.range.end - this.range.start);
		this.els.timeCurrent.textContent = formatTime(this.currentTime);
		this.updateTranscriptHighlights();
	}

	private startPlayheadLoop() {
		const tick = () => {
			if (!this.visible) return;
			if (this.video) {
				this.currentTime = this.video.currentTime;
				if (!this.exporting && this.currentTime >= this.range.end && !this.video.paused) {
					this.video.pause();
					this.previewing = false;
				}
				this.updateUI();

				// Highlight and auto-scroll transcript line
				if (this.transcriptSegments && this.transcriptSegments.length > 0 && this.showTranscript) {
					let activeIndex = -1;
					for (let i = 0; i < this.transcriptSegments.length; i++) {
						const seg = this.transcriptSegments[i];
						if (this.currentTime >= seg.start && this.currentTime < seg.end) {
							activeIndex = i;
							break;
						}
					}
					if (activeIndex === -1) {
						for (let i = this.transcriptSegments.length - 1; i >= 0; i--) {
							if (this.currentTime >= this.transcriptSegments[i].start) {
								activeIndex = i;
								break;
							}
						}
					}
					if (activeIndex === -1 && this.transcriptSegments.length > 0) {
						activeIndex = 0;
					}
					if (activeIndex !== -1 && activeIndex !== this.activeTranscriptIndex) {
						const lines = this.els['transcript-box'].children;
						if (this.activeTranscriptIndex >= 0 && this.activeTranscriptIndex < lines.length) {
							(lines[this.activeTranscriptIndex] as HTMLElement).classList.remove('active');
						}
						this.activeTranscriptIndex = activeIndex;
						if (activeIndex < lines.length) {
							const activeEl = lines[activeIndex] as HTMLElement;
							activeEl.classList.add('active');
							activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
						}
					}
				}
			}
			this.rafId = requestAnimationFrame(tick);
		};
		cancelAnimationFrame(this.rafId);
		this.rafId = requestAnimationFrame(tick);
	}

	private togglePreview() {
		if (!this.video) return;
		if (this.previewing) {
			this.video.pause();
			this.previewing = false;
		} else {
			this.video.currentTime = this.range.start;
			this.video.play();
			this.previewing = true;
		}
		this.updatePlayBtn();
	}

	private stopPreview() {
		this.previewing = false;
		this.video?.pause();
		this.updatePlayBtn();
	}

	private updatePlayBtn() {
		const btn = this.shadow?.querySelector('.play-btn') as HTMLElement;
		if (!btn) return;
		btn.classList.toggle('playing', this.previewing);
		btn.innerHTML = this.previewing
			? `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
			: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
	}

	private async refreshStreamStatus() {
		const [streams, bridgeOk] = await Promise.all([resolveStreamUrls(), checkBridgeHealth()]);
		this.streamsReady = hasUsableStreams(streams);

		if (this.exportMode === 'bridge') {
			if (bridgeOk) {
				this.setStatus('Bridge Ready — Instant high-quality export.', 'success');
			} else if (this.streamsReady) {
				this.setStatus('Ready — exports H.264 MP4 for web, iPhone, and Mac.');
			} else {
				this.setStatus('Play the video ~10s to capture the stream, OR start the yt-dlp bridge for instant export.');
			}
		} else {
			this.setStatus('Playback Mode — Will record selection from your player.', 'progress');
		}
	}

	private setStatus(text: string, type: 'error' | 'progress' | 'success' | '' = '') {
		const el = this.els.status;
		el.textContent = text;
		el.className = `status ${type}`;
	}

	private setProgress(visible: boolean, percent = 0) {
		this.els['progress-bar'].classList.toggle('visible', visible);
		(this.els['progress-fill'] as HTMLElement).style.width = `${percent}%`;
	}

	async export() {
		if (this.exporting) return;
		this.exporting = true;
		(this.els.exportBtn as HTMLButtonElement).disabled = true;
		this.setProgress(true, 0);
		stopClipPlayback();
		this.stopPreview();

		try {
			if (this.exportMode === 'bridge') {
				const [streams, bridgeOk] = await Promise.all([resolveStreamUrls(), checkBridgeHealth()]);
				this.streamsReady = hasUsableStreams(streams);

				if (bridgeOk || this.streamsReady) {
					try {
						await this.exportViaStreams(streams);
						return;
					} catch (error) {
						console.error('[Trimmer] Fast export via streams failed:', error);
						const message = error instanceof Error ? error.message : 'High-speed export failed';
						this.setStatus(`${message} — you can try switching to Playback mode.`, 'error');
						return;
					}
				} else {
					throw new Error('Bridge/Stream not ready. Play the video or switch to Playback mode.');
				}
			}

			// Playback mode or forced fallback
			await this.exportViaRecording();
		} catch (error) {
			console.error('[Trimmer] Export failed with error:', error);
			this.setProgress(false);
			this.setStatus(error instanceof Error ? error.message : 'Export failed', 'error');
		} finally {
			this.exporting = false;
			(this.els.exportBtn as HTMLButtonElement).disabled = false;
		}
	}

	private clearExportListener() {
		if (this.exportListener) {
			chrome.runtime.onMessage.removeListener(this.exportListener);
			this.exportListener = null;
		}
	}

	private waitForExportResult(): Promise<number | undefined> {
		this.clearExportListener();

		return new Promise((resolve, reject) => {
			this.exportListener = (message) => {
				if (message?.type === 'EXPORT_TRIM_PROGRESS') {
					const progress = message as { percent?: number; message?: string };
					this.setProgress(true, progress.percent ?? 0);
					this.setStatus(progress.message ?? 'Processing…', 'progress');
				}

				if (message?.type === 'EXPORT_TRIM_RESULT') {
					const result = message as ExportTrimResult;
					this.clearExportListener();
					if (result.success) {
						resolve(result.downloadId);
					} else {
						const err = new Error(result.error ?? 'Export failed');
						console.error('[Trimmer] Received EXPORT_TRIM_RESULT indicating failure:', err);
						reject(err);
					}
				}
			};

			chrome.runtime.onMessage.addListener(this.exportListener);
		});
	}

	private async exportViaStreams(streams: Awaited<ReturnType<typeof resolveStreamUrls>>) {
		this.setStatus('Preparing fast export…', 'progress');

		const startPromise = this.waitForExportResult();
		const result = (await chrome.runtime.sendMessage({
			type: 'EXPORT_TRIM',
			title: getVideoTitle(),
			videoId: getVideoIdFromUrl(window.location.href) ?? '',
			duration: this.duration,
			range: { ...this.range },
			streams,
		})) as ExportTrimResult | undefined;

		if (!result?.success) {
			this.clearExportListener();
			throw new Error(result?.error ?? 'Could not start export');
		}

		const downloadId = await startPromise;

		this.setProgress(false);
		this.showSuccess(downloadId);
	}

	private async exportViaRecording() {
		this.setStatus('Recording selection from player…', 'progress');
		try {
			const blob = await recordSelection(this.range, (message) => {
				this.setStatus(message, 'progress');
			});

			const safeTitle = getVideoTitle().replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 60) || 'youtube-clip';
			const filename = `${safeTitle}-trim.mp4`;

			if (blob.type.includes('mp4')) {
				this.setStatus('Optimizing MP4 for web & Apple…', 'progress');
			} else {
				this.setStatus('Encoding H.264 + AAC MP4…', 'progress');
			}

			const startPromise = this.waitForExportResult();
			const buffer = await blob.arrayBuffer();
			const result = (await chrome.runtime.sendMessage({
				type: 'EXPORT_TRANSCODE',
				filename,
				mimeType: blob.type || 'video/webm',
				buffer,
			})) as ExportTrimResult | undefined;

			if (!result?.success) {
				this.clearExportListener();
				const err = new Error(result?.error ?? 'Could not encode MP4');
				console.error('[Trimmer] EXPORT_TRANSCODE call returned failure status:', err);
				throw err;
			}

			const downloadId = await startPromise;

			this.setProgress(false);
			this.showSuccess(downloadId);
		} catch (error) {
			console.error('[Trimmer] exportViaRecording execution failed:', error);
			throw error;
		}
	}

	private showSuccess(downloadId?: number) {
		const el = this.els.status;
		el.innerHTML = 'Clip saved to your downloads! ';
		el.className = 'status success';

		if (downloadId !== undefined && downloadId !== 0) {
			const link = document.createElement('a');
			link.href = '#';
			link.textContent = 'Show in Finder';
			link.style.color = '#ffd60a';
			link.style.textDecoration = 'underline';
			link.style.marginLeft = '8px';
			link.style.cursor = 'pointer';
			link.onclick = (e) => {
				e.preventDefault();
				chrome.runtime.sendMessage({ type: 'SHOW_DOWNLOAD', downloadId });
			};
			el.appendChild(link);
		}
	}

}

export const trimmerOverlay = new TrimmerOverlay();