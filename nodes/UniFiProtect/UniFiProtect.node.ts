import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { unifiProtectRequestAllItems } from '../UniFi/transport';
import {
	buildProtectProperties,
	handleProtectResource,
	PROTECT_RESOURCE_OPTIONS,
	protectResourcePath,
} from './resources';

export class UniFiProtect implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'UniFi Protect',
		name: 'uniFiProtect',
		icon: 'file:unifiProtect.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Control UniFi Protect cameras, sensors, sirens, lights and more',
		defaults: { name: 'UniFi Protect' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'unifiApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: PROTECT_RESOURCE_OPTIONS,
				default: 'camera',
			},
			...buildProtectProperties(),
		],
	};

	methods = {
		loadOptions: {
			async getItems(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const resource = this.getCurrentNodeParameter('resource') as string;
				if (!resource) return [];
				const items = await unifiProtectRequestAllItems.call(this, `/v1/${protectResourcePath(resource)}`);
				return items.map((it) => ({
					name: `${(it.name as string) || (it.modelKey as string) || (it.id as string)}`,
					value: it.id as string,
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
				const result = await handleProtectResource.call(this, resource, operation, i);
				returnData.push(...result);
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
