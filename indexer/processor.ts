import {DOMParser} from 'https://deno.land/x/deno_dom@v0.1.36-alpha/deno-dom-wasm.ts';

import AsyncLockPool from "./async-lock-pool.ts";

function positive_int_from_env_var(s_var: string, n_default: number): number {
	const s_value = Deno.env.get(s_var);

	const z_value = s_value? parseInt(s_value): n_default;

	return Number.isInteger(z_value)? z_value: n_default;
}

const N_MAX_REDIRECTS = positive_int_from_env_var('MAX_REDIRECTS', 4);
const N_LIMIT_LENGTH_NAME = positive_int_from_env_var('LIMIT_NAME_LENGTH', 32);
const N_LIMIT_LENGTH_DESCRIPTION = positive_int_from_env_var('LIMIT_DESCRIPTION_LENGTH', 128);
const NB_MAX_SIZE_ICON = positive_int_from_env_var('MAX_ICON_SIZE', 2 << 20);  // 2 MiB

export type AppDescriptor = {
	host: string;
	homepage: string;
	name: string;
	description: string;
	icon: string;
};

export class RemovableOffense extends Error {
	constructor(protected _s_host: string, protected _s_violation: string) {
		super(`Host ${_s_host} is in violation of: ${_s_violation}`);
	}

	get host(): string {
		return this._s_host;
	}

	get violation(): string {
		return this._s_violation;
	}
}

export async function process_dapp(s_host: string, kp_clients: AsyncLockPool|null=null): Promise<AppDescriptor> {
	// prep homepage url
	let p_homepage = `https://${s_host}/`;

	// perform network io
	let s_text = '';
	{
		// checkout client from pool
		const f_release = await kp_clients?.acquire();

		// cache starting origin
		const s_original_origin = new URL(p_homepage).origin;

		DEREFERENCE:
		try {
			RETRY:
			for(let c_redirects=0; c_redirects<N_MAX_REDIRECTS; c_redirects++) {
				// make request
				const d_res = await fetch(p_homepage, {
					headers: {
						accept: 'text/html',
					},
					redirect: 'manual',
				});

				// read response to end
				s_text = await d_res.text();

				// redirect
				if(d_res.redirected) {
					const p_redirect = d_res.url;

					// redirect is on different protocol or origin
					const du_redirect = new URL(p_redirect);
					if(!p_redirect.startsWith(s_original_origin) && ('https:' !== du_redirect.protocol || s_original_origin !== du_redirect.origin)) {
						throw new RemovableOffense(s_host, `<${p_homepage}> attempted to redirect to a different origin`);
					}

					// follow redirect
					p_homepage = p_redirect;

					// retry
					continue RETRY;
				}

				// assert OK status code
				if(!d_res.ok) throw new Error(`Site <${p_homepage}> returned not OK response code: ${d_res.status}`);

				// done
				break DEREFERENCE;
			}

			// too many redirects
			throw new RemovableOffense(s_host, 'too many redirects');
		}
		finally {
			// release client back to pool
			f_release?.();
		}
	}

	// empty response body
	if(!s_text) throw new RemovableOffense(s_host, `<${p_homepage}> returned an empty response body`);

	// parse text as html
	const d_doc = new DOMParser().parseFromString(s_text, 'text/html');

	// ref doc head
	const dm_head = d_doc?.head;

	// empty or incomplete document
	if(!dm_head?.childElementCount) throw new Error(`Site <${p_homepage}> did not return a complete HTML document`);

	// parse manifest.json
	let g_manifest: null|{
		short_name?: string;
		description?: string;
		icons: {
			src: string;
			type: string;
		}[];
		start_url: string;
	} = null;
	READ_MANIFEST: {
		const dm_manifest = dm_head.querySelector('link[rel="manifest"][href]');
		const sr_manifest = dm_manifest?.getAttribute('href');

		// no manifest
		if(!sr_manifest) break READ_MANIFEST;

		// checkout client from pool
		const f_release = await kp_clients?.acquire();

		try {
			// resolve manifest URL
			const p_manifest = new URL(sr_manifest, p_homepage)+'';

			// make request
			const d_res = await fetch(p_manifest);

			// read and parse JSON
			g_manifest = await d_res.json();
		}
		finally {
			// release client back to pool
			f_release?.();
		}
	}

	// app name
	let s_app_name = '';
	APP_NAME: {
		const dm_app_name = dm_head.querySelector('meta[name="application-name"]');
		s_app_name = dm_app_name?.getAttribute('content') || '';

		// good
		if(s_app_name) break APP_NAME;

		// fallback to og:site_name
		const dm_open_graph = dm_head.querySelector('meta[property="og:site_name"][content]');
		s_app_name = dm_open_graph?.getAttribute('content') || '';

		// good
		if(s_app_name) break APP_NAME;

		// fallback to manifest
		s_app_name = g_manifest?.short_name || '';

		// missing app name
		throw new RemovableOffense(s_host, 'app name');
	}

	// app description
	let s_app_description = '';
	APP_DESCRIPTION: {
		const dm_app_description = dm_head.querySelector('meta[name="description"][content]');
		s_app_description = dm_app_description?.getAttribute('content') || '';

		// good
		if(s_app_description) break APP_DESCRIPTION;

		// fallback to og:description
		const dm_open_graph = dm_head.querySelector('meta[property="og:description"][content]');
		s_app_description = dm_open_graph?.getAttribute('content') || '';

		// good
		if(s_app_description) break APP_DESCRIPTION;

		// fallback to manifest
		s_app_description = g_manifest?.description || '';
		
		// good
		if(s_app_description) break APP_DESCRIPTION;
	}

	// app icon
	let sr_app_icon = '';
	APP_ICON: {
		const dm_icon = dm_head.querySelector('link[rel="icon"][type^="image/svg+xml"][href]');
		sr_app_icon = dm_icon?.getAttribute('href') || '';

		// good
		if(sr_app_icon) break APP_ICON;

		// try manifest
		sr_app_icon = g_manifest?.icons.find(g => g.type.startsWith('image/svg+xml'))?.src || '';

		// good
		if(sr_app_icon) break APP_ICON;

		// missing icon
		throw new RemovableOffense(s_host, 'app icon');
	}

	// cache icon
	let sr_icon = '';
	CACHE_ICON: {
		// resolve icon URL
		const p_app_icon = new URL(sr_app_icon, p_homepage);

		// perform network io
		let sx_icon: string;
		{
			// checkout client from pool
			const f_release = await kp_clients?.acquire();

			try {
				// make request
				const d_res = await fetch(p_app_icon);

				// read response to end
				sx_icon = await d_res.text();

				// assert OK status code
				if(!d_res.ok) throw new Error(`Icon <${p_app_icon}> returned not OK response code: ${d_res.status}`);
			}
			finally {
				// release client back to pool
				f_release?.();
			}
		}

		// assert svg size
		if(sx_icon.length > NB_MAX_SIZE_ICON) {
			throw new RemovableOffense(s_host, `Icon <${p_app_icon}> is too large`);
		}

		// assert parseable
		new DOMParser().parseFromString(sx_icon, 'text/html');

		// hash icon
		const atu8_digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sx_icon)));

		// encode hash
		const sb64_hash = btoa([...atu8_digest].map((xb) => String.fromCharCode(xb)).join(''));

		// replace non-safe characters, convert into modified base64url
		const sb64u_file = sb64_hash.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

		// prep file name
		sr_icon = `cache/${sb64u_file}.svg`;

		// write file
		try {
			await Deno.writeTextFile(sr_icon, sx_icon, {
				createNew: true,
			});
		}
		catch(e_write) {
			// already exists
			if('EEXIST' === e_write.code) break CACHE_ICON;

			// write failure
			throw e_write;
		}
	}

	// return struct
	return {
		host: s_host,
		homepage: p_homepage,
		name: s_app_name.slice(0, N_LIMIT_LENGTH_NAME),
		description: (s_app_description || '').slice(0, N_LIMIT_LENGTH_DESCRIPTION),
		icon: sr_icon,
	};
}
