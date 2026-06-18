import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { properties } from './properties';
import { GENERIC_RESOURCE_VALUES, handleGenericResource } from './genericResources';
import {
	getDeviceMac,
	legacyDeviceCommand,
	resolveSiteInternalRef,
	setLegacyPortOverride,
	unifiApiRequest,
	unifiApiRequestAllItems,
	unifiLegacyRequest,
} from './transport';

export class UniFi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'UniFi',
		name: 'uniFi',
		icon: 'file:unifi.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read and control Ubiquiti UniFi switches and networks',
		defaults: { name: 'UniFi' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'unifiApi', required: true }],
		properties,
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
				const devices = await unifiApiRequestAllItems.call(
					this,
					`/v1/sites/${siteId}/devices`,
				);
				return devices.map((d) => ({
					name: `${(d.name as string) || (d.model as string)} (${d.macAddress as string})`,
					value: d.id as string,
				}));
			},

			async getNetworks(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const siteId = this.getCurrentNodeParameter('siteId') as string;
				if (!siteId) return [];
				const networks = await unifiApiRequestAllItems.call(
					this,
					`/v1/sites/${siteId}/networks`,
				);
				return networks.map((n) => ({
					name: (n.name as string) ?? (n.id as string),
					value: n.id as string,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const siteId = this.getNodeParameter('siteId', i, '') as string;
				let responseData: IDataObject | IDataObject[] = {};

				// ------------------------------------------- REGISTRY RESOURCES
				if (GENERIC_RESOURCE_VALUES.includes(resource)) {
					responseData = await handleGenericResource.call(this, resource, operation, i);
				}

				// --------------------------------------------------------- DEVICE
				else if (resource === 'device') {
					const base = `/v1/sites/${siteId}/devices`;
					if (operation === 'get') {
						const deviceId = this.getNodeParameter('deviceId', i) as string;
						responseData = await unifiApiRequest.call(this, 'GET', `${base}/${deviceId}`);
					} else if (operation === 'getAll') {
						responseData = await getMany.call(this, i, base);
					} else if (operation === 'getStatistics') {
						const deviceId = this.getNodeParameter('deviceId', i) as string;
						responseData = await unifiApiRequest.call(
							this,
							'GET',
							`${base}/${deviceId}/statistics/latest`,
						);
					} else if (operation === 'restart') {
						const deviceId = this.getNodeParameter('deviceId', i) as string;
						responseData = await unifiApiRequest.call(this, 'POST', `${base}/${deviceId}/actions`, {
							action: 'RESTART',
						});
						responseData = okOr(responseData, { action: 'RESTART', deviceId });
					} else if (operation === 'adopt') {
						const mac = this.getNodeParameter('mac', i) as string;
						responseData = await legacyDeviceCommand.call(this, siteId, mac, { cmd: 'adopt' });
					} else if (operation === 'forget') {
						const deviceId = this.getNodeParameter('deviceId', i) as string;
						const mac = await getDeviceMac.call(this, siteId, deviceId);
						responseData = await legacyDeviceCommand.call(this, siteId, mac, {
							cmd: 'delete-device',
						});
					} else if (operation === 'upgradeFirmware') {
						const deviceId = this.getNodeParameter('deviceId', i) as string;
						const mac = await getDeviceMac.call(this, siteId, deviceId);
						responseData = await legacyDeviceCommand.call(this, siteId, mac, { cmd: 'upgrade' });
					}
				}

				// ----------------------------------------------------------- PORT
				else if (resource === 'port') {
					const deviceId = this.getNodeParameter('deviceId', i) as string;
					if (operation === 'getAll') {
						const device = await unifiApiRequest.call(
							this,
							'GET',
							`/v1/sites/${siteId}/devices/${deviceId}`,
						);
						responseData = ((device.interfaces?.ports as IDataObject[]) ?? []).map((p) => ({
							...p,
							deviceId,
						}));
					} else if (operation === 'powerCyclePoe') {
						const portIdx = this.getNodeParameter('portIdx', i) as number;
						responseData = await unifiApiRequest.call(
							this,
							'POST',
							`/v1/sites/${siteId}/devices/${deviceId}/interfaces/ports/${portIdx}/actions`,
							{ action: 'POWER_CYCLE' },
						);
						responseData = okOr(responseData, { action: 'POWER_CYCLE', portIdx });
					} else if (operation === 'setPoeMode') {
						const portIdx = this.getNodeParameter('portIdx', i) as number;
						const poeMode = this.getNodeParameter('poeMode', i) as string;
						responseData = await setLegacyPortOverride.call(this, siteId, deviceId, portIdx, {
							poe_mode: poeMode,
						});
					} else if (operation === 'setOverride') {
						const portIdx = this.getNodeParameter('portIdx', i) as number;
						const patch = parseJsonParam.call(this, 'overrideJson', i);
						responseData = await setLegacyPortOverride.call(
							this,
							siteId,
							deviceId,
							portIdx,
							patch,
						);
					}
				}

				// --------------------------------------------------------- CLIENT
				else if (resource === 'client') {
					const base = `/v1/sites/${siteId}/clients`;
					if (operation === 'get') {
						const clientId = this.getNodeParameter('clientId', i) as string;
						responseData = await unifiApiRequest.call(this, 'GET', `${base}/${clientId}`);
					} else if (operation === 'getAll') {
						responseData = await getMany.call(this, i, base);
					} else if (operation === 'authorizeGuest' || operation === 'unauthorizeGuest') {
						const clientId = this.getNodeParameter('clientId', i) as string;
						const body: IDataObject = {
							action:
								operation === 'authorizeGuest'
									? 'AUTHORIZE_GUEST_ACCESS'
									: 'UNAUTHORIZE_GUEST_ACCESS',
						};
						if (operation === 'authorizeGuest') {
							Object.assign(body, this.getNodeParameter('authorizeOptions', i, {}) as IDataObject);
						}
						responseData = await unifiApiRequest.call(
							this,
							'POST',
							`${base}/${clientId}/actions`,
							body,
						);
						responseData = okOr(responseData, { action: body.action, clientId });
					} else if (operation === 'block' || operation === 'unblock') {
						const mac = this.getNodeParameter('clientMac', i) as string;
						const siteRef = await resolveSiteInternalRef.call(this, siteId);
						responseData = await unifiLegacyRequest.call(
							this,
							'POST',
							`/api/s/${siteRef}/cmd/stamgr`,
							{ cmd: operation === 'block' ? 'block-sta' : 'unblock-sta', mac },
						);
					}
				}

				// -------------------------------------------------------- NETWORK
				else if (resource === 'network') {
					const base = `/v1/sites/${siteId}/networks`;
					if (operation === 'get') {
						const networkId = this.getNodeParameter('networkId', i) as string;
						responseData = await unifiApiRequest.call(this, 'GET', `${base}/${networkId}`);
					} else if (operation === 'getAll') {
						responseData = await getMany.call(this, i, base);
					} else if (operation === 'create') {
						const body = parseJsonParam.call(this, 'networkData', i);
						responseData = await unifiApiRequest.call(this, 'POST', base, body);
					} else if (operation === 'update') {
						const networkId = this.getNodeParameter('networkId', i) as string;
						const body = parseJsonParam.call(this, 'networkData', i);
						responseData = await unifiApiRequest.call(this, 'PUT', `${base}/${networkId}`, body);
					} else if (operation === 'delete') {
						const networkId = this.getNodeParameter('networkId', i) as string;
						await unifiApiRequest.call(this, 'DELETE', `${base}/${networkId}`);
						responseData = { success: true, deleted: networkId };
					}
				}

				// --------------------------------------------------- CUSTOM / RAW
				else if (resource === 'custom') {
					const method = this.getNodeParameter('customMethod', i) as IHttpRequestMethods;
					const body = parseJsonParam.call(this, 'customBody', i);
					if (operation === 'apiCall') {
						const api = this.getNodeParameter('customApi', i) as string;
						const path = this.getNodeParameter('customPath', i) as string;
						const qs = parseJsonParam.call(this, 'customQuery', i);
						responseData =
							api === 'legacy'
								? await unifiLegacyRequest.call(this, method, path, body, qs)
								: await unifiApiRequest.call(this, method, path, body, qs);
					} else if (operation === 'connector') {
						const consoleId = this.getNodeParameter('consoleId', i) as string;
						const path = (this.getNodeParameter('connectorPath', i) as string).replace(/^\//, '');
						responseData = await unifiApiRequest.call(
							this,
							method,
							`/v1/connector/consoles/${consoleId}/${path}`,
							body,
						);
					}
					responseData = responseData ?? {};
				}

				const asArray = Array.isArray(responseData) ? responseData : [responseData];
				returnData.push(
					...asArray.map((json) => ({ json, pairedItem: { item: i } })),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

// --------------------------------------------------------------------------- helpers

async function getMany(
	this: IExecuteFunctions,
	i: number,
	endpoint: string,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const all = await unifiApiRequestAllItems.call(this, endpoint);
	if (returnAll) return all;
	const limit = this.getNodeParameter('limit', i, 50) as number;
	return all.slice(0, limit);
}

function parseJsonParam(this: IExecuteFunctions, name: string, i: number): IDataObject {
	const value = this.getNodeParameter(name, i) as string | IDataObject;
	if (typeof value === 'object') return value as IDataObject;
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(this.getNode(), `Parameter "${name}" is not valid JSON.`);
	}
}

/** Some action endpoints return 204/empty; surface a tidy confirmation object. */
function okOr(responseData: unknown, fallback: IDataObject): IDataObject {
	if (responseData && typeof responseData === 'object' && Object.keys(responseData).length > 0) {
		return responseData as IDataObject;
	}
	return { success: true, ...fallback };
}
