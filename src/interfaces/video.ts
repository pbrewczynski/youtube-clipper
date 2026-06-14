import type { IVideoClip } from './clip-time';

export interface IVideo {
	id: string;
	title: string;
	clips: IVideoClip[];
	loop: boolean;
}

export interface IVideox {
	id: string;
	title: string;
	start: number;
	end: number;
	loop: boolean;
}
