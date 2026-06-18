import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	unifiProtectBinary,
	unifiProtectRequest,
	unifiProtectRequestAllItems,
} from '../UniFi/transport';

/**
 * The Protect node is fully registry-driven. Each resource declares its standard
 * CRUD-ish operations (list / get / create / update(PATCH) / delete) plus any
 * "command" endpoints (snapshot, PTZ, siren play, relay activate, ...). The UI
 * fields, operation lists, and request routing are all generated from this table.
 */

type ParamLocation = 'path' | 'query' | 'body';

interface CmdParam {
	name: string; // n8n field name (and default API key)
	display: string;
	type: 'string' | 'number' | 'boolean' | 'options' | 'json';
	location: ParamLocation;
	required?: boolean;
	default?: string | number | boolean;
	options?: Array<{ name: string; value: string }>;
	apiKey?: string; // override the body/query key sent to the API
	omitValue?: string; // an option value that means "omit this field" (e.g. toggle)
	boolMap?: boolean; // map on/off option values to boolean true/false
	description?: string;
}

interface Command {
	name: string; // display, e.g. "Get Snapshot"
	value: string; // operation value, e.g. "getSnapshot"
	method: IHttpRequestMethods;
	suffix: string; // appended after the (optional) /{id}; may contain {param} placeholders
	needsId?: boolean; // most commands act on a specific device
	binary?: boolean; // response is binary (snapshot)
	description?: string;
	params?: CmdParam[];
}

interface ProtectResource {
	name: string;
	value: string;
	path: string; // collection path segment, e.g. "cameras"
	list?: boolean;
	getById?: boolean;
	create?: boolean;
	patch?: boolean; // Protect uses PATCH for updates
	del?: boolean;
	commands?: Command[];
}

const STATE_OPTIONS = [
	{ name: 'On', value: 'on' },
	{ name: 'Off', value: 'off' },
	{ name: 'Toggle', value: 'toggle' },
];

export const PROTECT_RESOURCES: ProtectResource[] = [
	{
		name: 'Camera',
		value: 'camera',
		path: 'cameras',
		list: true,
		getById: true,
		patch: true,
		commands: [
			{
				name: 'Get Snapshot',
				value: 'getSnapshot',
				method: 'GET',
				suffix: '/snapshot',
				needsId: true,
				binary: true,
				params: [
					{ name: 'channel', display: 'Channel', type: 'string', location: 'query' },
					{ name: 'highQuality', display: 'High Quality', type: 'boolean', location: 'query', default: false },
				],
			},
			{
				name: 'PTZ Go To Preset',
				value: 'ptzGoto',
				method: 'POST',
				suffix: '/ptz/goto/{slot}',
				needsId: true,
				params: [{ name: 'slot', display: 'Preset Slot', type: 'string', location: 'path', required: true }],
			},
			{
				name: 'Start Patrol',
				value: 'patrolStart',
				method: 'POST',
				suffix: '/ptz/patrol/start/{slot}',
				needsId: true,
				params: [{ name: 'slot', display: 'Patrol Slot', type: 'string', location: 'path', required: true }],
			},
			{ name: 'Stop Patrol', value: 'patrolStop', method: 'POST', suffix: '/ptz/patrol/stop', needsId: true },
			{ name: 'Create Talkback Session', value: 'talkback', method: 'POST', suffix: '/talkback-session', needsId: true },
			{ name: 'Disable Mic Permanently', value: 'disableMic', method: 'POST', suffix: '/disable-mic-permanently', needsId: true },
		],
	},
	{
		name: 'Siren',
		value: 'siren',
		path: 'sirens',
		list: true,
		getById: true,
		patch: true,
		commands: [
			{
				name: 'Play',
				value: 'play',
				method: 'POST',
				suffix: '/play',
				needsId: true,
				params: [{ name: 'duration', display: 'Duration (Seconds)', type: 'number', location: 'body', default: 5 }],
			},
			{ name: 'Stop', value: 'stop', method: 'POST', suffix: '/stop', needsId: true },
			{
				name: 'Test Sound',
				value: 'testSound',
				method: 'POST',
				suffix: '/test-sound',
				needsId: true,
				params: [{ name: 'volume', display: 'Volume', type: 'number', location: 'body' }],
			},
		],
	},
	{
		name: 'Speaker',
		value: 'speaker',
		path: 'speakers',
		list: true,
		getById: true,
		patch: true,
		commands: [
			{
				name: 'Test Sound',
				value: 'testSound',
				method: 'POST',
				suffix: '/test-sound',
				needsId: true,
				params: [{ name: 'volume', display: 'Volume', type: 'number', location: 'body' }],
			},
		],
	},
	{
		name: 'Relay',
		value: 'relay',
		path: 'relays',
		list: true,
		getById: true,
		patch: true,
		commands: [
			{
				name: 'Activate Output',
				value: 'activate',
				method: 'POST',
				suffix: '/outputs/{outputId}/activate',
				needsId: true,
				params: [
					{ name: 'outputId', display: 'Output ID', type: 'number', location: 'path', required: true },
					{ name: 'state', display: 'State', type: 'options', location: 'body', options: STATE_OPTIONS, default: 'on', omitValue: 'toggle', description: 'Use Toggle to flip the current state' },
					{ name: 'pulseDuration', display: 'Pulse Duration (Ms)', type: 'number', location: 'body', description: 'Auto-off after this many ms (only when state is On)' },
				],
			},
		],
	},
	{
		name: 'Alarm Hub',
		value: 'alarmHub',
		path: 'alarm-hubs',
		list: true,
		getById: true,
		patch: true,
		commands: [
			{
				name: 'Trigger Output',
				value: 'trigger',
				method: 'POST',
				suffix: '/outputs/{outputId}/trigger',
				needsId: true,
				params: [
					{ name: 'outputId', display: 'Output ID', type: 'number', location: 'path', required: true },
					{ name: 'enable', display: 'Enable', type: 'options', location: 'body', options: STATE_OPTIONS, default: 'on', omitValue: 'toggle', boolMap: true, description: 'On/Off, or Toggle the current state' },
					{ name: 'delay', display: 'Delay (Ms)', type: 'number', location: 'body' },
					{ name: 'duration', display: 'Duration (Ms)', type: 'number', location: 'body', description: '0 = indefinite until turned off' },
				],
			},
		],
	},
	{
		name: 'Arm Profile',
		value: 'armProfile',
		path: 'arm-profiles',
		list: true,
		create: true,
		patch: true,
		del: true,
		commands: [
			{ name: 'Enable (All)', value: 'enable', method: 'POST', suffix: '/enable', needsId: false },
			{ name: 'Disable (All)', value: 'disable', method: 'POST', suffix: '/disable', needsId: false },
			{
				name: 'Update Settings',
				value: 'updateSettings',
				method: 'PATCH',
				suffix: '/settings',
				needsId: false,
				params: [{ name: 'settings', display: 'Settings (JSON)', type: 'json', location: 'body', apiKey: '__raw__', default: '{}' }],
			},
		],
	},

	// Light/sensor/chime + read/patch device families
	{ name: 'Light', value: 'light', path: 'lights', list: true, getById: true, patch: true },
	{ name: 'Sensor', value: 'sensor', path: 'sensors', list: true, getById: true, patch: true },
	{ name: 'Chime', value: 'chime', path: 'chimes', list: true, getById: true, patch: true },
	{ name: 'Bridge', value: 'bridge', path: 'bridges', list: true, getById: true, patch: true },
	{ name: 'Fob', value: 'fob', path: 'fobs', list: true, getById: true, patch: true },
	{ name: 'Link Station', value: 'linkStation', path: 'link-stations', list: true, getById: true, patch: true },
	{ name: 'Viewer', value: 'viewer', path: 'viewers', list: true, getById: true, patch: true },
	{ name: 'Liveview', value: 'liveview', path: 'liveviews', list: true, getById: true, create: true, patch: true },

	// Read-only
	{ name: 'NVR', value: 'nvr', path: 'nvrs', list: true },
	{ name: 'User', value: 'user', path: 'users', list: true, getById: true },
	{ name: 'ULP User', value: 'ulpUser', path: 'ulp-users', list: true, getById: true },
];

export const PROTECT_RESOURCE_OPTIONS = PROTECT_RESOURCES.map((r) => ({ name: r.name, value: r.value }));
export const PROTECT_RESOURCE_VALUES = PROTECT_RESOURCES.map((r) => r.value);

/** Resources whose device list can populate an ID dropdown (need an item GET-able set). */
export const LISTABLE_RESOURCES = PROTECT_RESOURCES.filter((r) => r.list).map((r) => r.value);

function standardOps(r: ProtectResource) {
	const ops: Array<{ name: string; value: string; action: string }> = [];
	if (r.list) ops.push({ name: 'Get Many', value: 'getAll', action: `Get many ${r.name.toLowerCase()}` });
	if (r.getById) ops.push({ name: 'Get', value: 'get', action: `Get a ${r.name.toLowerCase()}` });
	if (r.create) ops.push({ name: 'Create', value: 'create', action: `Create a ${r.name.toLowerCase()}` });
	if (r.patch) ops.push({ name: 'Update', value: 'update', action: `Update a ${r.name.toLowerCase()}` });
	if (r.del) ops.push({ name: 'Delete', value: 'delete', action: `Delete a ${r.name.toLowerCase()}` });
	for (const c of r.commands ?? []) ops.push({ name: c.name, value: c.value, action: c.name.toLowerCase() });
	return ops;
}

/** Operations on a resource that require a specific item ID. */
function idOperations(r: ProtectResource): string[] {
	const ops: string[] = [];
	if (r.getById) ops.push('get');
	if (r.patch) ops.push('update');
	if (r.del) ops.push('delete');
	for (const c of r.commands ?? []) if (c.needsId) ops.push(c.value);
	return ops;
}

/** Primary params are shown as direct fields; the rest go in an "Options" collection. */
function isDirect(p: CmdParam): boolean {
	return p.location === 'path' || !!p.required || p.type === 'options' || p.type === 'json';
}

export function buildProtectProperties(): INodeProperties[] {
	const props: INodeProperties[] = [];

	// Operation dropdown per resource
	for (const r of PROTECT_RESOURCES) {
		props.push({
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [r.value] } },
			options: standardOps(r),
			default: 'getAll',
		});
	}

	// ID field per resource (dropdown of that resource's items)
	for (const r of PROTECT_RESOURCES) {
		const idOps = idOperations(r);
		if (idOps.length === 0) continue;
		props.push({
			displayName: `${r.name} Name or ID`,
			name: 'itemId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getItems', loadOptionsDependsOn: ['resource'] },
			default: '',
			required: true,
			displayOptions: { show: { resource: [r.value], operation: idOps } },
			description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		});
	}

	// Create/Update JSON body per resource
	for (const r of PROTECT_RESOURCES) {
		const ops: string[] = [];
		if (r.create) ops.push('create');
		if (r.patch) ops.push('update');
		if (ops.length === 0) continue;
		props.push({
			displayName: 'Data (JSON)',
			name: 'dataJson',
			type: 'json',
			default: '{}',
			displayOptions: { show: { resource: [r.value], operation: ops } },
			description: 'The request body to send to the Protect API',
		});
	}

	// Command parameters. Primary params (path IDs, required, options, JSON) are
	// direct fields; optional params live in an "Add Option" collection so they
	// are only sent when the user explicitly sets them (avoids e.g. volume=0).
	const defaultFor = (p: CmdParam) =>
		p.default ?? (p.type === 'number' ? 0 : p.type === 'boolean' ? false : '');

	for (const r of PROTECT_RESOURCES) {
		for (const c of r.commands ?? []) {
			const params = c.params ?? [];
			const direct = params.filter((p) => isDirect(p));
			const optional = params.filter((p) => !isDirect(p));

			for (const p of direct) {
				const field: INodeProperties = {
					displayName: p.display,
					name: p.name,
					type: p.type === 'json' ? 'json' : p.type,
					default: defaultFor(p),
					required: p.required ?? false,
					displayOptions: { show: { resource: [r.value], operation: [c.value] } },
				};
				if (p.options) field.options = p.options;
				if (p.description) field.description = p.description;
				props.push(field);
			}

			if (optional.length) {
				props.push({
					displayName: 'Options',
					name: 'commandOptions',
					type: 'collection',
					placeholder: 'Add Option',
					default: {},
					displayOptions: { show: { resource: [r.value], operation: [c.value] } },
					options: optional.map((p) => {
						const opt: INodeProperties = {
							displayName: p.display,
							name: p.name,
							type: p.type === 'json' ? 'json' : p.type,
							default: defaultFor(p),
						};
						if (p.options) opt.options = p.options;
						if (p.description) opt.description = p.description;
						return opt;
					}),
				});
			}
		}
	}

	// Snapshot binary property name
	props.push({
		displayName: 'Put Output In Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		displayOptions: { show: { resource: ['camera'], operation: ['getSnapshot'] } },
		description: 'Name of the binary field to store the snapshot image in',
	});

	// Pagination for list operations
	props.push({
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: PROTECT_RESOURCE_VALUES, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	});
	props.push({
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: { resource: PROTECT_RESOURCE_VALUES, operation: ['getAll'], returnAll: [false] },
		},
		description: 'Max number of results to return',
	});

	return props;
}

export function protectResourcePath(resource: string): string {
	const def = PROTECT_RESOURCES.find((r) => r.value === resource);
	if (!def) throw new Error(`Unknown Protect resource "${resource}".`);
	return def.path;
}

function parseJson(this: IExecuteFunctions, name: string, i: number): IDataObject {
	const value = this.getNodeParameter(name, i) as string | IDataObject;
	if (typeof value === 'object') return value as IDataObject;
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(this.getNode(), `Parameter "${name}" is not valid JSON.`);
	}
}

/** Executes any Protect resource operation. Returns execution items (handles binary). */
export async function handleProtectResource(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const def = PROTECT_RESOURCES.find((r) => r.value === resource);
	if (!def) throw new NodeOperationError(this.getNode(), `Unknown Protect resource "${resource}".`);

	const base = `/v1/${def.path}`;
	const wrap = (data: IDataObject | IDataObject[]): INodeExecutionData[] =>
		(Array.isArray(data) ? data : [data]).map((json) => ({ json, pairedItem: { item: i } }));

	// --- Standard operations -------------------------------------------------
	if (operation === 'getAll') {
		const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
		const all = await unifiProtectRequestAllItems.call(this, base);
		return wrap(returnAll ? all : all.slice(0, this.getNodeParameter('limit', i, 50) as number));
	}
	if (operation === 'get') {
		const id = this.getNodeParameter('itemId', i) as string;
		return wrap(await unifiProtectRequest.call(this, 'GET', `${base}/${id}`));
	}
	if (operation === 'create') {
		return wrap(await unifiProtectRequest.call(this, 'POST', base, parseJson.call(this, 'dataJson', i)));
	}
	if (operation === 'update') {
		const id = this.getNodeParameter('itemId', i) as string;
		return wrap(await unifiProtectRequest.call(this, 'PATCH', `${base}/${id}`, parseJson.call(this, 'dataJson', i)));
	}
	if (operation === 'delete') {
		const id = this.getNodeParameter('itemId', i) as string;
		await unifiProtectRequest.call(this, 'DELETE', `${base}/${id}`);
		return wrap({ success: true, deleted: id });
	}

	// --- Command operations --------------------------------------------------
	const command = (def.commands ?? []).find((c) => c.value === operation);
	if (!command) {
		throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}" for "${resource}".`);
	}

	let path = base;
	if (command.needsId) path += `/${this.getNodeParameter('itemId', i) as string}`;

	let suffix = command.suffix;
	const body: IDataObject = {};
	const qs: IDataObject = {};

	const collection = this.getNodeParameter('commandOptions', i, {}) as IDataObject;

	for (const p of command.params ?? []) {
		let raw: unknown;
		if (isDirect(p)) {
			raw = p.type === 'json' ? undefined : this.getNodeParameter(p.name, i, p.default);
		} else {
			if (!(p.name in collection)) continue; // user did not set this optional param
			raw = collection[p.name];
		}

		if (p.location === 'path') {
			suffix = suffix.replace(`{${p.name}}`, String(raw));
		} else if (p.location === 'query') {
			if (raw !== '' && raw !== undefined && raw !== null) qs[p.apiKey ?? p.name] = raw;
		} else if (p.type === 'json') {
			Object.assign(body, parseJson.call(this, p.name, i));
		} else if (p.type === 'options') {
			if (raw !== p.omitValue && raw !== '' && raw !== undefined && raw !== null) {
				body[p.apiKey ?? p.name] = p.boolMap ? raw === 'on' : raw;
			}
		} else if (raw !== '' && raw !== undefined && raw !== null) {
			body[p.apiKey ?? p.name] = raw;
		}
	}
	path += suffix;

	// Binary response (snapshot)
	if (command.binary) {
		const { buffer, contentType } = await unifiProtectBinary.call(this, path, qs);
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
		const ext = contentType.split('/')[1] ?? 'jpg';
		const itemId = command.needsId ? (this.getNodeParameter('itemId', i) as string) : 'snapshot';
		const binaryData = await this.helpers.prepareBinaryData(buffer, `${itemId}.${ext}`, contentType);
		return [
			{
				json: { resource, operation, itemId, contentType },
				binary: { [binaryPropertyName]: binaryData },
				pairedItem: { item: i },
			},
		];
	}

	const response = await unifiProtectRequest.call(this, command.method, path, body, qs);
	return wrap(response && typeof response === 'object' ? response : { success: true, operation });
}
