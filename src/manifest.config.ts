import { defineManifest } from '@crxjs/vite-plugin';
import packageJson from '../package.json';

const { version, name, description } = packageJson;

// Convert from Semver (example: 0.1.0-beta6)
const [major, minor, patch] = version
	// can only contain digits, dots, or dash
	.replace(/[^\d.-]+/g, '')
	// split into version parts
	.split(/[.-]/);

export default defineManifest(async (env) => ({
	manifest_version: 3,
	name: 'Youtube Clipper',
	description: description,
	version: `${major}.${minor}.${patch}`,
	version_name: version,
	icons: {
		'16': 'src/assets/icons/icon16.png',
		'32': 'src/assets/icons/icon32.png',
		'48': 'src/assets/icons/icon48.png',
		'128': 'src/assets/icons/icon128.png',
	},
	content_scripts: [
		{
			matches: ['*://www.youtube.com/watch*', '*://www.youtube.com/shorts*'],
			js: ['src/content/index.ts'],
			run_at: 'document_idle',
		},
	],
	background: {
		service_worker: 'src/background/index.ts',
	},
	options_ui: {
		page: 'src/options/index.html',
		open_in_tab: false,
	},
	side_panel: {
		default_path: 'src/sidepanel/index.html',
	},
	action: {
		default_popup: 'src/popup/index.html',
		default_icon: {
			'16': 'src/assets/icons/icon16.png',
			'32': 'src/assets/icons/icon32.png',
			'48': 'src/assets/icons/icon48.png',
			'128': 'src/assets/icons/icon128.png',
		},
	},
	commands: {
		'play-toggle': {
			suggested_key: {
				default: 'Alt+C',
			},
			description: 'Play/Pause the first Youtube video tab',
		},
	},
	permissions: ['activeTab', 'tabs', 'scripting', 'storage', 'downloads', 'offscreen', 'webRequest'],
	host_permissions: [
		'http://*/',
		'https://*/',
		'*://*.googlevideo.com/*',
		'*://www.youtube.com/*',
	],
	web_accessible_resources: [
		{
			resources: ['assets/*.js', 'assets/*.css', 'ffmpeg/*', 'src/offscreen/index.html'],
			matches: ['*://*.youtube.com/*'],
			use_dynamic_url: true,
		},
		{
			resources: ['ffmpeg/*', 'src/offscreen/index.html'],
			matches: ['<all_urls>'],
		},
	],
	content_security_policy: {
		extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
	},
}));
