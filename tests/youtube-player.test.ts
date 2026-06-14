import { describe, it, expect } from 'vitest';
import { formatTime } from '../src/content/trimmer/trimmer-overlay';
import { getVideoIdFromUrl, parseStoryboard, getStoryboardTileUrl } from '../src/utils/youtube-player';

// Mocking formatTime since it's exported from trimmer-overlay but used globally
// Note: In a real test we'd move formatTime to a shared utility file.

describe('YouTube Player Utilities', () => {
	it('extracts video ID from various URLs', () => {
		expect(getVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
		expect(getVideoIdFromUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(null); // Current impl only handles ?v= or /shorts/
		expect(getVideoIdFromUrl('https://www.youtube.com/shorts/abc123xyz')).toBe('abc123xyz');
	});

	it('parses storyboard specs correctly', () => {
		const mockResponse = {
			storyboards: {
				playerStoryboardSpecRenderer: {
					spec: 'https://i.ytimg.com/sb/video/storyboard$L_L$N.jpg|48#27#100#10#10#0#default#rs$A'
				}
			}
		};
		const info = parseStoryboard(mockResponse);
		expect(info).not.toBeNull();
		expect(info?.baseUrl).toContain('storyboard3_L0.jpg');
		expect(info?.width).toBe(48);
		expect(info?.height).toBe(27);
		expect(info?.count).toBe(100);
	});

	it('generates correct tile URL for a given time', () => {
		const info = {
			baseUrl: 'https://example.com/sb$N.jpg',
			level: 3,
			width: 160,
			height: 90,
			count: 100,
			interval: 10
		};
		// time 0 -> index 0
		expect(getStoryboardTileUrl(info, 0, 1000)).toBe('https://example.com/sb0.jpg');
		// time 15 -> index 1 (since interval is 10)
		expect(getStoryboardTileUrl(info, 15, 1000)).toBe('https://example.com/sb1.jpg');
		// time 95 -> index 9
		expect(getStoryboardTileUrl(info, 95, 1000)).toBe('https://example.com/sb9.jpg');
	});
});
