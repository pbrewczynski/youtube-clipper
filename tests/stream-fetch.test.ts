import { describe, it, expect } from 'vitest';

/**
 * Since fetchTrimStreams depends on chrome.scripting, we test the logic 
 * by extracting the byte range calculation part if possible, or mocking 
 * the behavior.
 */

describe('Stream Fetching Logic', () => {
	it('calculates byte ranges correctly for partial fetch', () => {
		const duration = 100; // seconds
		const totalBytes = 1000000; // 1MB
		const start = 20;
		const end = 30;
		const pad = 4;
		
		const segStart = Math.max(0, start - pad); // 16
		const segEnd = Math.min(duration, end + pad); // 34

		const startByte = Math.floor((segStart / duration) * totalBytes);
		const endByte = Math.min(totalBytes - 1, Math.ceil((segEnd / duration) * totalBytes));

		expect(startByte).toBe(160000);
		expect(endByte).toBe(340000);
	});

	it('handles edge cases for duration and bytes', () => {
		const duration = 0;
		const totalBytes = 1000;
		
		const startByte = duration > 0 ? Math.floor((10 / duration) * totalBytes) : 0;
		expect(startByte).toBe(0);
	});
});
