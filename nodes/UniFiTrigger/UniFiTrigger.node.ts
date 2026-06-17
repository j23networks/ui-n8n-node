import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';

import { unifiApiRequest, unifiApiRequestAllItems } from '../UniFi/transport';

/**
 * The official UniFi Network API has no webhooks, so this trigger polls and
 * diffs against workflow static data to detect changes between runs.
 *
 * Cheap events (one list call): device state change, firmware-update available,
 * new client. Expensive events (one detail call per device): port link change,
 * PoE fault — restrict with the "Device" filter to keep poll cost down.
 */
export class UniFiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'UniFi Trigger',
		name: 'uniFiTrigger',
		icon: 'file:unifiTrigger.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when something changes on UniFi (polling)',
		defaults: { name: 'UniFi Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionType.Main],
		credentials: [{ name: 'unifiApi', required: true }],
		properties: [
			{
				displayName: 'Site Name or ID',
				name: 'siteId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSites' },
				default: '',
				required: true,
				description: 'Choose from the list, or specify an ID using an expression',
			},
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				default: 'deviceStateChanged',
				options: [
					{
						name: 'Device State Changed',
						value: 'deviceStateChanged',
						description: 'A device went online/offline or otherwise changed state',
					},
					{
						name: 'Firmware Update Available',
						value: 'firmwareUpdateAvailable',
						description: 'A device newly has a firmware update available',
					},
					{
						name: 'New Client Connected',
						value: 'newClient',
						description: 'A client not seen before appeared on the site',
					},
					{
						name: 'Port Link Changed',
						value: 'portLinkChanged',
						description: 'A switch port went up or down (one detail call per device)',
					},
					{
						name: 'PoE Fault',
						value: 'poeFault',
						description: 'A PoE-enabled port stopped delivering power (DOWN/LIMITED)',
					},
				],
			},
			{
				displayName: 'Device Name or ID',
				name: 'deviceId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getDevices', loadOptionsDependsOn: ['siteId'] },
				default: '',
				displayOptions: { show: { event: ['portLinkChanged', 'poeFault'] } },
				description:
					'Limit polling to a single switch (recommended). Leave empty to scan all devices. Choose from the list, or specify an ID by expression.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getSites(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const sites = await unifiApiRequestAllItems.call(this, '/v1/sites');
				return sites.map((s) => ({ name: (s.name as string) ?? (s.id as string), value: s.id as string }));
			},
			async getDevices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const siteId = this.getCurrentNodeParameter('siteId') as string;
				if (!siteId) return [];
				const devices = await unifiApiRequestAllItems.call(this, `/v1/sites/${siteId}/devices`);
				return devices.map((d) => ({
					name: `${(d.name as string) || (d.model as string)} (${d.macAddress as string})`,
					value: d.id as string,
				}));
			},
		},
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const siteId = this.getNodeParameter('siteId') as string;
		const event = this.getNodeParameter('event') as string;
		const isManual = this.getMode() === 'manual';
		const staticData = this.getWorkflowStaticData('node') as IDataObject;

		let emitted: IDataObject[] = [];

		if (event === 'deviceStateChanged') {
			const devices = await unifiApiRequestAllItems.call(this, `/v1/sites/${siteId}/devices`);
			if (isManual) {
				emitted = devices;
			} else {
				const previous = (staticData.deviceStates as IDataObject) ?? {};
				const next: IDataObject = {};
				for (const d of devices) {
					const id = d.id as string;
					next[id] = d.state as string;
					const before = previous[id] as string | undefined;
					if (before !== undefined && before !== d.state) {
						emitted.push({ ...d, previousState: before });
					}
				}
				staticData.deviceStates = next;
			}
		} else if (event === 'firmwareUpdateAvailable') {
			const devices = await unifiApiRequestAllItems.call(this, `/v1/sites/${siteId}/devices`);
			if (isManual) {
				emitted = devices.filter((d) => d.firmwareUpdatable === true);
			} else {
				const flagged = new Set((staticData.firmwareFlagged as string[]) ?? []);
				const stillFlagged: string[] = [];
				for (const d of devices) {
					const id = d.id as string;
					if (d.firmwareUpdatable === true) {
						stillFlagged.push(id);
						if (!flagged.has(id)) emitted.push(d);
					}
				}
				staticData.firmwareFlagged = stillFlagged;
			}
		} else if (event === 'newClient') {
			const clients = await unifiApiRequestAllItems.call(this, `/v1/sites/${siteId}/clients`);
			if (isManual) {
				emitted = clients.slice(0, 10);
			} else {
				const seen = new Set((staticData.seenClients as string[]) ?? []);
				const isFirstRun = seen.size === 0;
				for (const c of clients) {
					const id = c.id as string;
					if (!seen.has(id)) {
						seen.add(id);
						if (!isFirstRun) emitted.push(c);
					}
				}
				staticData.seenClients = Array.from(seen);
			}
		} else if (event === 'portLinkChanged' || event === 'poeFault') {
			const ports = await collectPorts.call(this, siteId);
			if (isManual) {
				emitted = ports.slice(0, 20);
			} else {
				const key = event === 'poeFault' ? 'poeStates' : 'portStates';
				const previous = (staticData[key] as IDataObject) ?? {};
				const next: IDataObject = {};
				for (const p of ports) {
					const k = `${p.deviceId as string}:${p.idx as number}`;
					if (event === 'poeFault') {
						const poe = (p.poe as IDataObject) ?? {};
						const faulted =
							poe.enabled === true && (poe.state === 'DOWN' || poe.state === 'LIMITED');
						next[k] = faulted ? 'FAULT' : 'OK';
						if (previous[k] !== undefined && previous[k] !== 'FAULT' && faulted) {
							emitted.push(p);
						}
					} else {
						next[k] = p.state as string;
						if (previous[k] !== undefined && previous[k] !== p.state) {
							emitted.push({ ...p, previousState: previous[k] });
						}
					}
				}
				staticData[key] = next;
			}
		}

		if (emitted.length === 0) return null;
		return [this.helpers.returnJsonArray(emitted)];
	}
}

/**
 * Fetches every (or one) device's detail and flattens its ports, tagging each
 * with its deviceId/name so downstream nodes know which switch/port fired.
 */
async function collectPorts(this: IPollFunctions, siteId: string): Promise<IDataObject[]> {
	const deviceFilter = this.getNodeParameter('deviceId', '') as string;
	let deviceIds: string[];

	if (deviceFilter) {
		deviceIds = [deviceFilter];
	} else {
		const devices = await unifiApiRequestAllItems.call(this, `/v1/sites/${siteId}/devices`);
		deviceIds = devices.map((d) => d.id as string);
	}

	const ports: IDataObject[] = [];
	for (const deviceId of deviceIds) {
		const device = await unifiApiRequest.call(
			this,
			'GET',
			`/v1/sites/${siteId}/devices/${deviceId}`,
		);
		const devicePorts = (device.interfaces?.ports as IDataObject[]) ?? [];
		for (const p of devicePorts) {
			ports.push({ ...p, deviceId, deviceName: device.name });
		}
	}
	return ports;
}
