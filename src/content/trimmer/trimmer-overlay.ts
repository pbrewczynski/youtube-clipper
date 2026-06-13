import type { ExportTrimResult, TrimRange } from '../../messaging';
import {
	getVideoDuration,
	getVideoIdFromUrl,
	getVideoTitle,
	hasUsableStreams,
	resolveStreamUrls,
} from './trimmer-utils';
import { recordSelection } from './record-fallback';
import { stopClipPlayback } from '../clip-playback';

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
	width: min(920px, calc(100vw - 32px));
	margin-bottom: 24px;
	background: linear-gradient(180deg, rgba(38, 38, 40, 0.98) 0%, rgba(28, 28, 30, 0.98) 100%);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 14px;
	box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
	color: #f5f5f7;
	overflow: hidden;
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
	gap: 8px;
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
	background: repeating-linear-gradient(
		90deg,
		rgba(255, 255, 255, 0.04) 0,
		rgba(255, 255, 255, 0.04) 1px,
		transparent 1px,
		transparent 48px
	);
	pointer-events: none;
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
	gap: 10px;
	padding: 12px 18px 16px;
}

.play-btn {
	width: 36px;
	height: 36px;
	border-radius: 50%;
	border: none;
	background: rgba(255, 255, 255, 0.12);
	color: #fff;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 14px;
}

.play-btn:hover { background: rgba(255, 255, 255, 0.2); }

.range-labels {
	display: flex;
	gap: 16px;
	font-size: 11px;
	opacity: 0.75;
	font-variant-numeric: tabular-nums;
	flex: 1;
}

.shortcuts {
	font-size: 10px;
	opacity: 0.45;
}

.status {
	padding: 0 18px 14px;
	font-size: 12px;
	min-height: 18px;
}

.status.error { color: #ff6b6b; }
.status.progress { color: #ffd60a; }
.status.success { color: #4cd964; }

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
`;

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

	private els: Record<string, HTMLElement> = {};

	show() {
		if (this.visible) return;
		stopClipPlayback();
		this.init();
		this.visible = true;
		this.host!.style.display = 'flex';
		this.syncFromVideo();
		this.seekTo(this.range.start);
		this.updateUI();
		this.startPlayheadLoop();
		void this.refreshStreamStatus();

		this.video?.addEventListener(
			'loadedmetadata',
			() => {
				this.syncFromVideo();
				this.updateUI();
			},
			{ once: true }
		);
	}

	hide() {
		this.visible = false;
		if (this.host) this.host.style.display = 'none';
		this.stopPreview();
		this.clearExportListener();
		cancelAnimationFrame(this.rafId);
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
					<div class="timeline-wrap" data-el="timeline">
						<div class="timeline-track"></div>
						<div class="dim-left" data-el="dim-left"></div>
						<div class="dim-right" data-el="dim-right"></div>
						<div class="selection" data-el="selection"></div>
						<div class="handle handle-start" data-el="handle-start"></div>
						<div class="handle handle-end" data-el="handle-end"></div>
						<div class="playhead" data-el="playhead">
							<div class="playhead-hit" data-el="playhead-hit"></div>
							<div class="playhead-line"></div>
							<div class="playhead-knob"></div>
						</div>
					</div>
				</div>
				<div class="controls">
					<button class="play-btn" data-action="play-selection" title="Play selection">▶</button>
					<div class="range-labels">
						<span>In <strong data-el="in-label">0:00</strong></span>
						<span>Out <strong data-el="out-label">0:00</strong></span>
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

		overlay.addEventListener('click', (e) => {
			const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
			if (!target) return;
			const action = target.dataset.action;
			if (action === 'cancel') this.hide();
			if (action === 'export') this.export();
			if (action === 'play-selection') this.togglePreview();
		});

		overlay.addEventListener('mousedown', (e) => this.onPointerDown(e.clientX, e.target as HTMLElement, e.shiftKey));
		overlay.addEventListener('touchstart', (e) => {
			const touch = e.touches[0];
			this.onPointerDown(touch.clientX, e.target as HTMLElement, e.shiftKey);
		}, { passive: true });

		const onMove = (clientX: number) => this.onPointerMove(clientX);
		const onUp = () => this.onPointerUp();

		window.addEventListener('mousemove', (e) => onMove(e.clientX));
		window.addEventListener('mouseup', onUp);
		window.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX), { passive: true });
		window.addEventListener('touchend', onUp);

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

	private onPointerMove(clientX: number) {
		if (!this.dragTarget) return;
		const rect = this.els.timeline.getBoundingClientRect();
		const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
		const time = this.percentToTime(percent);

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
	}

	private startPlayheadLoop() {
		const tick = () => {
			if (!this.visible) return;
			if (this.video) {
				this.currentTime = this.video.currentTime;
				if (this.previewing && this.currentTime >= this.range.end) {
					this.video.pause();
					this.previewing = false;
				}
				this.updateUI();
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
			return;
		}
		this.video.currentTime = this.range.start;
		this.video.play();
		this.previewing = true;
	}

	private stopPreview() {
		this.previewing = false;
		this.video?.pause();
	}

	private async refreshStreamStatus() {
		const streams = await resolveStreamUrls();
		this.streamsReady = hasUsableStreams(streams);
		if (this.streamsReady) {
			this.setStatus('Ready — exports H.264 MP4 for web, iPhone, and Mac.');
		} else {
			this.setStatus('Ready — will record and encode to web-friendly MP4 if needed.');
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
			const streams = await resolveStreamUrls();
			this.streamsReady = hasUsableStreams(streams);

			if (this.streamsReady) {
				try {
					await this.exportViaStreams(streams);
					return;
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Stream export failed';
					this.setStatus(`${message} — falling back to recording…`, 'progress');
				}
			}

			await this.exportViaRecording();
		} catch (error) {
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

	private waitForExportResult(): Promise<void> {
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
					if (result.success) resolve();
					else reject(new Error(result.error ?? 'Export failed'));
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
			range: { ...this.range },
			streams,
		})) as ExportTrimResult | undefined;

		if (!result?.success) {
			this.clearExportListener();
			throw new Error(result?.error ?? 'Could not start export');
		}

		await startPromise;

		this.setProgress(false);
		this.setStatus('Clip saved to your downloads!', 'success');
	}

	private async exportViaRecording() {
		this.setStatus('Recording selection from player…', 'progress');
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
			throw new Error(result?.error ?? 'Could not encode MP4');
		}

		await startPromise;

		this.setProgress(false);
		this.setStatus('Clip saved to your downloads!', 'success');
	}

}

export const trimmerOverlay = new TrimmerOverlay();