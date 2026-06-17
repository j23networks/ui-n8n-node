import type { INodeProperties } from 'n8n-workflow';

import {
	buildGenericProperties,
	GENERIC_RESOURCE_OPTIONS,
	NON_SITE_SCOPED,
} from './genericResources';

/**
 * Operations are tagged in their description with the API they use, but the user
 * does not have to care — the node routes automatically. "(needs local account)"
 * is the only thing they may need to act on.
 */

const siteField: INodeProperties = {
	displayName: 'Site Name or ID',
	name: 'siteId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getSites' },
	default: '',
	required: true,
	// Hidden for the handful of resources that live under /v1 directly (not per-site),
	// and for the Custom resource where the user supplies the full path.
	displayOptions: { hide: { resource: [...NON_SITE_SCOPED, 'custom'] } },
	description:
		'The UniFi site to operate on. Choose from the list, or specify an ID using an expression.',
};

const deviceField: INodeProperties = {
	displayName: 'Device Name or ID',
	name: 'deviceId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getDevices', loadOptionsDependsOn: ['siteId'] },
	default: '',
	required: true,
	description: 'The switch/device to operate on. Choose from the list, or specify an ID by expression.',
};

export const properties: INodeProperties[] = [
	// -------------------------------------------------------------- Resource
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Device', value: 'device' },
			{ name: 'Port', value: 'port' },
			{ name: 'Client', value: 'client' },
			{ name: 'Network (VLAN)', value: 'network' },
			...GENERIC_RESOURCE_OPTIONS,
			{ name: 'Custom / Raw API Call', value: 'custom' },
		],
		default: 'device',
	},

	// -------------------------------------------------------------- Device ops
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['device'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get a device', description: 'Official API' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many devices', description: 'Official API' },
			{
				name: 'Get Statistics',
				value: 'getStatistics',
				action: 'Get device statistics',
				description: 'Official API — CPU, memory, uptime',
			},
			{ name: 'Restart', value: 'restart', action: 'Restart a device', description: 'Official API' },
			{
				name: 'Adopt',
				value: 'adopt',
				action: 'Adopt a device',
				description: 'Needs local account',
			},
			{
				name: 'Forget',
				value: 'forget',
				action: 'Forget a device',
				description: 'Needs local account',
			},
			{
				name: 'Upgrade Firmware',
				value: 'upgradeFirmware',
				action: 'Upgrade device firmware',
				description: 'Needs local account',
			},
		],
		default: 'getAll',
	},

	// -------------------------------------------------------------- Port ops
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['port'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many ports',
				description: 'Official API — read port state & PoE from the device',
			},
			{
				name: 'Power Cycle PoE',
				value: 'powerCyclePoe',
				action: 'Power cycle PoE on a port',
				description: 'Official API',
			},
			{
				name: 'Set PoE Mode',
				value: 'setPoeMode',
				action: 'Set PoE mode on a port',
				description: 'Needs local account',
			},
			{
				name: 'Set Port Override (Advanced)',
				value: 'setOverride',
				action: 'Set a raw port override',
				description: 'Needs local account — apply raw port_override JSON',
			},
		],
		default: 'getAll',
	},

	// -------------------------------------------------------------- Client ops
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['client'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get a client', description: 'Official API' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many clients', description: 'Official API' },
			{
				name: 'Authorize Guest',
				value: 'authorizeGuest',
				action: 'Authorize guest access',
				description: 'Official API',
			},
			{
				name: 'Unauthorize Guest',
				value: 'unauthorizeGuest',
				action: 'Unauthorize guest access',
				description: 'Official API',
			},
			{ name: 'Block', value: 'block', action: 'Block a client', description: 'Needs local account' },
			{
				name: 'Unblock',
				value: 'unblock',
				action: 'Unblock a client',
				description: 'Needs local account',
			},
		],
		default: 'getAll',
	},

	// -------------------------------------------------------------- Network ops
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['network'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get a network', description: 'Official API' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many networks', description: 'Official API' },
			{ name: 'Create', value: 'create', action: 'Create a network', description: 'Official API' },
			{ name: 'Update', value: 'update', action: 'Update a network', description: 'Official API' },
			{ name: 'Delete', value: 'delete', action: 'Delete a network', description: 'Official API' },
		],
		default: 'getAll',
	},

	// -------------------------------------------------------------- Common fields
	siteField,

	// Device id (device resource: get/getStatistics/restart/forget/upgradeFirmware)
	{
		...deviceField,
		displayOptions: {
			show: {
				resource: ['device'],
				operation: ['get', 'getStatistics', 'restart', 'forget', 'upgradeFirmware'],
			},
		},
	},
	// Device id (port resource: all port ops act on a device)
	{
		...deviceField,
		displayOptions: { show: { resource: ['port'] } },
	},

	// MAC for adopt (device not yet adopted -> not selectable from list)
	{
		displayName: 'MAC Address',
		name: 'mac',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'aa:bb:cc:dd:ee:ff',
		displayOptions: { show: { resource: ['device'], operation: ['adopt'] } },
		description: 'MAC address of the pending device to adopt',
	},

	// Port index for all single-port operations
	{
		displayName: 'Port Index',
		name: 'portIdx',
		type: 'number',
		default: 1,
		required: true,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: { resource: ['port'], operation: ['powerCyclePoe', 'setPoeMode', 'setOverride'] },
		},
		description: 'The physical port number on the switch (1-based)',
	},

	// PoE mode
	{
		displayName: 'PoE Mode',
		name: 'poeMode',
		type: 'options',
		default: 'auto',
		displayOptions: { show: { resource: ['port'], operation: ['setPoeMode'] } },
		options: [
			{ name: 'Auto (802.3af/at/bt)', value: 'auto' },
			{ name: 'Passive 24V', value: 'pasv24' },
			{ name: 'Passthrough', value: 'passthrough' },
			{ name: 'Off', value: 'off' },
		],
	},

	// Raw override JSON (advanced)
	{
		displayName: 'Override (JSON)',
		name: 'overrideJson',
		type: 'json',
		default: '{\n  "name": "Uplink"\n}',
		displayOptions: { show: { resource: ['port'], operation: ['setOverride'] } },
		description:
			'Raw fields to merge into this port\'s port_override entry (e.g. {"forward":"disabled"}, {"native_networkconf_id":"..."}, {"name":"..."})',
	},

	// Client id (official client ops)
	{
		displayName: 'Client ID',
		name: 'clientId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['client'],
				operation: ['get', 'authorizeGuest', 'unauthorizeGuest'],
			},
		},
	},
	// Client MAC (legacy block/unblock work by MAC)
	{
		displayName: 'Client MAC Address',
		name: 'clientMac',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'aa:bb:cc:dd:ee:ff',
		displayOptions: { show: { resource: ['client'], operation: ['block', 'unblock'] } },
	},
	// Guest authorize options
	{
		displayName: 'Authorize Options',
		name: 'authorizeOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['client'], operation: ['authorizeGuest'] } },
		options: [
			{ displayName: 'Time Limit (Minutes)', name: 'timeLimitMinutes', type: 'number', default: 60 },
			{
				displayName: 'Data Usage Limit (MB)',
				name: 'dataUsageLimitMBytes',
				type: 'number',
				default: 0,
			},
			{ displayName: 'Download Limit (Kbps)', name: 'rxRateLimitKbps', type: 'number', default: 0 },
			{ displayName: 'Upload Limit (Kbps)', name: 'txRateLimitKbps', type: 'number', default: 0 },
		],
	},

	// Network id
	{
		displayName: 'Network Name or ID',
		name: 'networkId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getNetworks', loadOptionsDependsOn: ['siteId'] },
		default: '',
		required: true,
		displayOptions: { show: { resource: ['network'], operation: ['get', 'update', 'delete'] } },
		description: 'Choose from the list, or specify an ID using an expression',
	},
	// Network body (create/update)
	{
		displayName: 'Network Data (JSON)',
		name: 'networkData',
		type: 'json',
		default: '{\n  "name": "VLAN 20",\n  "vlanId": 20\n}',
		displayOptions: { show: { resource: ['network'], operation: ['create', 'update'] } },
		description: 'The network/VLAN definition to send to the UniFi API',
	},

	// Return all toggle for list ops
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['device', 'client', 'network'],
				operation: ['getAll'],
			},
		},
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: {
				resource: ['device', 'client', 'network'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},

	// Registry-driven resources (firewall, ACL, DNS, VPN, switching, etc.)
	...buildGenericProperties(),

	// ----------------------------------------------------- Custom / Raw escape hatch
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['custom'] } },
		options: [
			{
				name: 'Custom API Call',
				value: 'apiCall',
				action: 'Make a custom API call',
				description: 'Call any UniFi endpoint (official or legacy)',
			},
			{
				name: 'Connector Passthrough',
				value: 'connector',
				action: 'Proxy a request to a connected console',
				description: 'Official connector/consoles passthrough',
			},
		],
		default: 'apiCall',
	},
	{
		displayName: 'API',
		name: 'customApi',
		type: 'options',
		default: 'official',
		displayOptions: { show: { resource: ['custom'], operation: ['apiCall'] } },
		options: [
			{ name: 'Official (Network Integration API)', value: 'official' },
			{ name: 'Legacy (Controller API)', value: 'legacy' },
		],
		description: 'Which UniFi API to call. Legacy requires a local account on the credential.',
	},
	{
		displayName: 'Console ID',
		name: 'consoleId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['custom'], operation: ['connector'] } },
	},
	{
		displayName: 'Method',
		name: 'customMethod',
		type: 'options',
		default: 'GET',
		displayOptions: { show: { resource: ['custom'] } },
		options: [
			{ name: 'GET', value: 'GET' },
			{ name: 'POST', value: 'POST' },
			{ name: 'PUT', value: 'PUT' },
			{ name: 'PATCH', value: 'PATCH' },
			{ name: 'DELETE', value: 'DELETE' },
		],
	},
	{
		displayName: 'Path',
		name: 'customPath',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['custom'], operation: ['apiCall'] } },
		placeholder: '/v1/sites/{siteId}/devices  or  /api/s/default/stat/device',
		description:
			'Full path. Official paths are relative to /proxy/network/integration; legacy paths to /proxy/network.',
	},
	{
		displayName: 'Path',
		name: 'connectorPath',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['custom'], operation: ['connector'] } },
		placeholder: 'some/console/endpoint',
		description: 'Path appended after the console ID',
	},
	{
		displayName: 'Query Parameters (JSON)',
		name: 'customQuery',
		type: 'json',
		default: '{}',
		displayOptions: { show: { resource: ['custom'], operation: ['apiCall'] } },
	},
	{
		displayName: 'Body (JSON)',
		name: 'customBody',
		type: 'json',
		default: '{}',
		displayOptions: { show: { resource: ['custom'], operation: ['apiCall', 'connector'] } },
		description: 'Request body for non-GET methods (ignored for GET)',
	},
];
