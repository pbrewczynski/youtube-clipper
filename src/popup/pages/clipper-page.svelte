<script lang="ts">
	import { onMount } from 'svelte';
	import Clipper from '../components/clipper.svelte';
	import type { IVideo } from '../../interfaces/video';
	import { storageDriver } from '../../storage-driver';
	import { storage } from '../stores/storage';
	import { secondToTimeString } from '../../utils/second-to-time-string';

	let youtubeTab: chrome.tabs.Tab | undefined;
	let videoId: string | undefined | null;
	let trimmerState: {
		visible: boolean;
		duration: number;
		range: { start: number; end: number };
	} | null = null;
	let statusMessage = '';

	let videos: IVideo[] | null = null;
	let init = false;

	$: $storage,
		(async () => {
			if (!init) {
				return;
			}
			await storageDriver.set($storage);
		})();

	onMount(async () => {
		const res = await storageDriver.get();
		init = true;
		storage.set(res);

		const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
		if (!activeTab?.url?.includes('youtube.com/watch') && !activeTab?.url?.includes('youtube.com/shorts')) {
			return;
		}
		const regex = /[?&]v=([^&#]+)/;
		const shortsRegex = /\/shorts\/([^/?&#]+)/;
		const match = activeTab.url?.match(regex) ?? activeTab.url?.match(shortsRegex);
		videoId = match && match[1];
		if (!videoId) {
			loadAllVideos();
			return;
		}
		youtubeTab = activeTab;
		await refreshTrimmerState();
	});

	async function refreshTrimmerState() {
		if (!youtubeTab?.id) return;
		try {
			const state = await chrome.tabs.sendMessage(youtubeTab.id, { type: 'GET_TRIMMER_STATE' });
			if (state?.type === 'TRIMMER_STATE') {
				trimmerState = state;
			}
		} catch {
			trimmerState = null;
		}
	}

	async function openTrimmer() {
		if (!youtubeTab?.id) return;
		try {
			await chrome.tabs.sendMessage(youtubeTab.id, { type: 'SHOW_TRIMMER' });
			statusMessage = 'Trimmer opened on YouTube';
			await refreshTrimmerState();
		} catch {
			statusMessage = 'Reload the YouTube page, then try again';
		}
	}

	function loadAllVideos() {
		const storedVideos = $storage.videos;
		const temp: IVideo[] = [];
		for (let key of Object.keys(storedVideos)) {
			const video = storedVideos[key];
			temp.push(video);
		}
		videos = temp;
	}

	async function removeSavedVideo(video: IVideo) {
		storage.update((prev) => {
			prev.lastSync = new Date().getTime();
			delete prev.videos[video.id];
			return prev;
		});
		const temp: IVideo[] = [];
		for (let key of Object.keys($storage.videos)) {
			const video = $storage.videos[key];
			temp.push(video);
		}
		videos = temp;
	}
</script>

<div class="w-full flex flex-col items-center">
	{#if youtubeTab && videoId}
		<div class="w-full rounded-lg border border-color0/40 bg-slate-100 dark:bg-slate-800/50 p-3 mb-3">
			<h2 class="text-sm font-semibold mb-1">QuickTime-style Trimmer</h2>
			<p class="text-xs opacity-70 mb-3">
				Drag the yellow handles on the timeline, preview your selection, then download an H.264 MP4 that plays everywhere.
			</p>
			<button
				class="w-full bg-color0 text-dark font-semibold py-2 rounded-md hover:opacity-90 transition-opacity"
				on:click={openTrimmer}
			>
				Open Trimmer on Video
			</button>
			{#if trimmerState}
				<p class="text-xs mt-2 opacity-75">
					Selection: {secondToTimeString(trimmerState.range.start)} → {secondToTimeString(trimmerState.range.end)}
				</p>
			{/if}
			{#if statusMessage}
				<p class="text-xs mt-1 text-green-600 dark:text-green-400">{statusMessage}</p>
			{/if}
		</div>

		<details class="w-full">
			<summary class="text-xs font-medium cursor-pointer opacity-70 mb-2">Saved clip timestamps (playback loops)</summary>
			<Clipper tab={youtubeTab} id={videoId} />
		</details>
	{/if}

	{#if !videos}
		<button class="bg-color0 px-2 py-1 rounded-md font-semibold text-dark dark:text-white mt-4" on:click={loadAllVideos}>Show Saved Videos</button>
	{:else if videos.length === 0}
		<h1 class="w-full text-center text-base mt-4 font-medium">There is no video yet</h1>
	{:else}
		<ul class={`w-full flex flex-col gap-1 ${videoId ? 'mt-4' : ''}`}>
			{#each videos as item}
				<li class="flex items-center justify-between border-[1px] border-color0 px-2 py-1 rounded">
					<a target="_blank" class="font-medium" href="http://youtube.com/watch?v={item.id}">{item.title}</a>
					<button
						on:click={() => {
							removeSavedVideo(item);
						}}>&#10005;</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</div>