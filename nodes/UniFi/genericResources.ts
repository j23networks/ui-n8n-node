import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { unifiApiRequest, unifiApiRequestAllItems } from './transport';

/**
 * The remaining official-API resources are plain CRUD/read-only collections, so
 * they are described by data rather than hand-written. One registry entry drives
 * the resource's operations, UI fields, and request routing.
 *
 *   - `path`        segment after the site (or root) base
 *   - `siteScoped`  whether the path lives under /v1/sites/{siteId}
 *   - `getById`     a GET /{id} endpoint exists
 *   - `crud`        create (POST) + delete (DELETE /{id}) exist
 *   - `noUpdate`    crud resource without a PUT /{id} (e.g. hotspot vouchers)
 *   - `patch`       a PATCH /{id} endpoint exists (partial update)
 *   - `ordering`    a /ordering GET+PUT pair exists
 */
export interface GenericResource {
	name: string;
	value: string;
	path: string;
	siteScoped: boolean;
	getById?: boolean;
	crud?: boolean;
	noUpdate?: boolean;
	patch?: boolean;
	ordering?: boolean;
}

export const GENERIC_RESOURCES: GenericResource[] = [
	// --- Full CRUD (great for NAC-style / policy automations) ---
	{ name: 'Firewall Policy', value: 'firewallPolicy', path: 'firewall/policies', siteScoped: true, getById: true, crud: true, patch: true, ordering: true },
	{ name: 'Firewall Zone', value: 'firewallZone', path: 'firewall/zones', siteScoped: true, getById: true, crud: true },
	{ name: 'ACL Rule', value: 'aclRule', path: 'acl-rules', siteScoped: true, getById: true, crud: true, ordering: true },
	{ name: 'DNS Policy', value: 'dnsPolicy', path: 'dns/policies', siteScoped: true, getById: true, crud: true },
	{ name: 'Traffic Matching List', value: 'trafficMatchingList', path: 'traffic-matching-lists', siteScoped: true, getById: true, crud: true },
	{ name: 'WiFi Broadcast', value: 'wifiBroadcast', path: 'wifi/broadcasts', siteScoped: true, getById: true, crud: true },
	{ name: 'Hotspot Voucher', value: 'hotspotVoucher', path: 'hotspot/vouchers', siteScoped: true, getById: true, crud: true, noUpdate: true },

	// --- Read-only (with single-item GET) ---
	{ name: 'Switch LAG', value: 'switchLag', path: 'switching/lags', siteScoped: true, getById: true },
	{ name: 'MC-LAG Domain', value: 'mcLagDomain', path: 'switching/mc-lag-domains', siteScoped: true, getById: true },
	{ name: 'Switch Stack', value: 'switchStack', path: 'switching/switch-stacks', siteScoped: true, getById: true },

	// --- Read-only (list only) ---
	{ name: 'WAN', value: 'wan', path: 'wans', siteScoped: true },
	{ name: 'RADIUS Profile', value: 'radiusProfile', path: 'radius/profiles', siteScoped: true },
	{ name: 'VPN Server', value: 'vpnServer', path: 'vpn/servers', siteScoped: true },
	{ name: 'Site-to-Site Tunnel', value: 'siteToSiteTunnel', path: 'vpn/site-to-site-tunnels', siteScoped: true },
	{ name: 'Device Tag', value: 'deviceTag', path: 'device-tags', siteScoped: true },

	// --- Read-only, NOT site-scoped (live under /v1 directly) ---
	{ name: 'Pending Device', value: 'pendingDevice', path: 'pending-devices', siteScoped: false },
	{ name: 'DPI Application', value: 'dpiApplication', path: 'dpi/applications', siteScoped: false },
	{ name: 'DPI Category', value: 'dpiCategory', path: 'dpi/categories', siteScoped: false },
	{ name: 'Country', value: 'country', path: 'countries', siteScoped: false },
];

export const GENERIC_RESOURCE_OPTIONS = GENERIC_RESOURCES.map((r) => ({ name: r.name, value: r.value }));
export const GENERIC_RESOURCE_VALUES = GENERIC_RESOURCES.map((r) => r.value);
export const NON_SITE_SCOPED = GENERIC_RESOURCES.filter((r) => !r.siteScoped).map((r) => r.value);

function operationsFor(r: GenericResource) {
	const ops: Array<{ name: string; value: string; action: string }> = [
		{ name: 'Get Many', value: 'getAll', action: `Get many ${r.name.toLowerCase()}` },
	];
	if (r.getById) ops.push({ name: 'Get', value: 'get', action: `Get a ${r.name.toLowerCase()}` });
	if (r.crud) {
		ops.push({ name: 'Create', value: 'create', action: `Create a ${r.name.toLowerCase()}` });
		if (!r.noUpdate) ops.push({ name: 'Update', value: 'update', action: `Update a ${r.name.toLowerCase()}` });
		if (r.patch) ops.push({ name: 'Update (Partial)', value: 'patchUpdate', action: `Patch a ${r.name.toLowerCase()}` });
		ops.push({ name: 'Delete', value: 'delete', action: `Delete a ${r.name.toLowerCase()}` });
	}
	if (r.ordering) {
		ops.push({ name: 'Get Ordering', value: 'getOrdering', action: `Get ${r.name.toLowerCase()} ordering` });
		ops.push({ name: 'Set Ordering', value: 'setOrdering', action: `Set ${r.name.toLowerCase()} ordering` });
	}
	return ops;
}

/** Builds every UI property for the registry-driven resources. */
export function buildGenericProperties(): INodeProperties[] {
	const props: INodeProperties[] = [];

	for (const r of GENERIC_RESOURCES) {
		props.push({
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [r.value] } },
			options: operationsFor(r),
			default: 'getAll',
		});
	}

	const idResources = GENERIC_RESOURCES.filter((r) => r.getById || r.crud).map((r) => r.value);
	props.push({
		displayName: 'ID',
		name: 'genericId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { resource: idResources, operation: ['get', 'update', 'patchUpdate', 'delete'] },
		},
		description: 'The ID of the item to act on',
	});

	const dataResources = GENERIC_RESOURCES.filter((r) => r.crud).map((r) => r.value);
	props.push({
		displayName: 'Data (JSON)',
		name: 'genericData',
		type: 'json',
		default: '{}',
		displayOptions: {
			show: { resource: dataResources, operation: ['create', 'update', 'patchUpdate'] },
		},
		description: 'The request body to send to the UniFi API',
	});

	const orderingResources = GENERIC_RESOURCES.filter((r) => r.ordering).map((r) => r.value);
	props.push({
		displayName: 'Ordering (JSON Array)',
		name: 'orderingData',
		type: 'json',
		default: '[]',
		displayOptions: { show: { resource: orderingResources, operation: ['setOrdering'] } },
		description: 'Ordered array of IDs to apply',
	});

	props.push({
		displayName: 'Return All',
		name: 'genericReturnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: GENERIC_RESOURCE_VALUES, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	});
	props.push({
		displayName: 'Limit',
		name: 'genericLimit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: {
				resource: GENERIC_RESOURCE_VALUES,
				operation: ['getAll'],
				genericReturnAll: [false],
			},
		},
		description: 'Max number of results to return',
	});

	return props;
}

function parseJson(this: IExecuteFunctions, name: string, i: number): unknown {
	const value = this.getNodeParameter(name, i) as string | object;
	if (typeof value === 'object') return value;
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(this.getNode(), `Parameter "${name}" is not valid JSON.`);
	}
}

/** Executes any registry-driven resource operation. */
export async function handleGenericResource(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const def = GENERIC_RESOURCES.find((r) => r.value === resource);
	if (!def) throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}".`);

	let base: string;
	if (def.siteScoped) {
		const siteId = this.getNodeParameter('siteId', i) as string;
		base = `/v1/sites/${siteId}/${def.path}`;
	} else {
		base = `/v1/${def.path}`;
	}

	switch (operation) {
		case 'getAll': {
			const returnAll = this.getNodeParameter('genericReturnAll', i, false) as boolean;
			const all = await unifiApiRequestAllItems.call(this, base);
			if (returnAll) return all;
			const limit = this.getNodeParameter('genericLimit', i, 50) as number;
			return all.slice(0, limit);
		}
		case 'get': {
			const id = this.getNodeParameter('genericId', i) as string;
			return unifiApiRequest.call(this, 'GET', `${base}/${id}`);
		}
		case 'create': {
			const body = parseJson.call(this, 'genericData', i) as IDataObject;
			return unifiApiRequest.call(this, 'POST', base, body);
		}
		case 'update': {
			const id = this.getNodeParameter('genericId', i) as string;
			const body = parseJson.call(this, 'genericData', i) as IDataObject;
			return unifiApiRequest.call(this, 'PUT', `${base}/${id}`, body);
		}
		case 'patchUpdate': {
			const id = this.getNodeParameter('genericId', i) as string;
			const body = parseJson.call(this, 'genericData', i) as IDataObject;
			return unifiApiRequest.call(this, 'PATCH', `${base}/${id}`, body);
		}
		case 'delete': {
			const id = this.getNodeParameter('genericId', i) as string;
			await unifiApiRequest.call(this, 'DELETE', `${base}/${id}`);
			return { success: true, deleted: id };
		}
		case 'getOrdering':
			return unifiApiRequest.call(this, 'GET', `${base}/ordering`);
		case 'setOrdering': {
			const body = parseJson.call(this, 'orderingData', i) as IDataObject;
			return unifiApiRequest.call(this, 'PUT', `${base}/ordering`, body);
		}
		default:
			throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}".`);
	}
}
