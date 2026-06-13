import type { IVideo } from '../interfaces/video';

export type ContentStorage = {
	videos: { [key: string]: IVideo };
	alwaysShuffle?: boolean;
	autoSkipAd?: boolean;
};

export async function getContentStorage(): Promise<ContentStorage> {
	const value = await chrome.storage.sync.get();
	return {
		videos: value.videos ?? {},
		alwaysShuffle: value.alwaysShuffle,
		autoSkipAd: value.autoSkipAd ?? false,
	};
}