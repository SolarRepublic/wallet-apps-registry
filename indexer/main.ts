import {readAll} from 'https://deno.land/std@0.129.0/streams/conversion.ts';
import {parse as parseArgv} from 'https://deno.land/std@0.175.0/flags/mod.ts';

import {AsyncLockPool} from './async-lock-pool.ts';
import {AppDescriptor, process_dapp, RemovableOffense} from './processor.ts';

// load current registry
import _A_REGISTRY from '../global.json' assert {type:'json'};
const A_REGISTRY: AppDescriptor[] = _A_REGISTRY;

const kp_clients = new AsyncLockPool(parseInt(Deno.env.get('CONCURRENT_REQUESTS') || '1'));

const a_tasks: Promise<AppDescriptor | null>[] = [];

const h_flags = parseArgv(Deno.args, {
	boolean: ['dry-run'],
});

const b_dryrun = !!h_flags['dry-run'];

// prep cache dir
if(!b_dryrun) {
	await Deno.mkdir('cache', {recursive:true});
}

// parse stdin; each host
const a_hosts = new TextDecoder().decode(await readAll(Deno.stdin)).trim().split(/\s+/g).filter(s => s);
for(const s_host of a_hosts) {
	// validate url
	try {
		new URL(`https://${s_host}/`);
	}
	catch(e_parse) {
		console.warn(`Skipping invalid host: '${s_host}'`);
		continue;
	}

	// process dapp
	a_tasks.push(process_dapp(s_host, kp_clients, b_dryrun));
}

// wait until all tasks settle
const a_settled = await Promise.allSettled(a_tasks);

const a_apps: AppDescriptor[] = [];

// extra messages for the commit
const a_messages: string[] = [
	`bot: automatic updates`,
];

// review each task result
for(const g_settled of a_settled) {
	// success; add to app list
	if('fulfilled' === g_settled.status) {
		const g_app = g_settled.value!;

		// accept app into registry
		a_apps.push(g_app);

		// app was already registered
		const g_existing = A_REGISTRY.find(g => g.host === g_settled.value?.host);
		if(g_existing) {
			// entry changed
			if(JSON.stringify(g_existing) !== JSON.stringify(g_app)) {
				a_messages.push(`Updated ${g_app.host}`);
			}
		}
		// new entry
		else {
			a_messages.push(`Added ${g_app.host}`);
		}
	}
	// failure
	else {
		// reason is a removable offense
		const e_reason = g_settled.reason;
		if(e_reason instanceof RemovableOffense) {
			// app is currently registered; add message to commit
			if(A_REGISTRY.find(g => g.host === e_reason.host)) {
				a_messages.push(`Removed ${e_reason.host} for ${e_reason.violation}`);
			}
		}

		// log reason and continue
		try {
			console.warn((g_settled.reason as Error).message);
		}
		catch(e_warn) {}
	}
}

// delete unused files
if(!b_dryrun) {
	const a_icons = a_apps.map(g => g.icon);
	const a_delete = [...Deno.readDirSync('cache')]
		.filter(g => g.isFile && !a_icons.includes(`cache/${g.name}`));

	for(const g_entry of a_delete) {
		await Deno.remove(`cache/${g_entry.name}`);
	}
}

// generate registry
const sx_registry = JSON.stringify(a_apps.sort((g_a, g_b) => g_a.host < g_b.host? -1: 1), null, '\t');

// save to file
if(b_dryrun) {
	console.log(sx_registry);
}
else {
	await Deno.writeTextFile('global.json', sx_registry);
}

// print commit message to stdout
console.log(a_messages.join('\n'));
