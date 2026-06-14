export type TrimRange = {
	start: number;
	end: number;
};

export type StreamUrls = {
	videoUrl?: string;
	audioUrl?: string;
	progressiveUrl?: string;
};

export type ExportTrimRequest = {
	type: 'EXPORT_TRIM';
	tabId?: number;
	title: string;
	videoId: string;
	range: TrimRange;
	duration: number;
	streams: StreamUrls;
};

export type ExportTrimProgress = {
	type: 'EXPORT_TRIM_PROGRESS';
	phase: 'downloading' | 'trimming' | 'saving';
	percent: number;
	message: string;
};

export type ExportTrimResult = {
	type: 'EXPORT_TRIM_RESULT';
	success: boolean;
	error?: string;
};

export type ExportTranscodeRequest = {
	type: 'EXPORT_TRANSCODE';
	tabId?: number;
	filename: string;
	mimeType: string;
	buffer: ArrayBuffer;
};

export type ShowTrimmerMessage = {
	type: 'SHOW_TRIMMER';
};

export type HideTrimmerMessage = {
	type: 'HIDE_TRIMMER';
};

export type GetTrimmerStateMessage = {
	type: 'GET_TRIMMER_STATE';
};

export type TrimmerStateResponse = {
	type: 'TRIMMER_STATE';
	visible: boolean;
	duration: number;
	currentTime: number;
	range: TrimRange;
	title: string;
	videoId: string;
};

export type SetTrimmerRangeMessage = {
	type: 'SET_TRIMMER_RANGE';
	range: TrimRange;
};

export type ContentMessage =
	| ShowTrimmerMessage
	| HideTrimmerMessage
	| GetTrimmerStateMessage
	| SetTrimmerRangeMessage
	| ExportTrimRequest;

export type BackgroundMessage = ExportTrimProgress | ExportTrimResult | TrimmerStateResponse;