import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

/**
 * UniFi Protect Alarm Manager can POST (or GET) a webhook when an alarm fires.
 * These are purely outbound — you paste this node's webhook URL into Protect, so
 * there is nothing to register against UniFi (no `webhookMethods`). The node just
 * listens, optionally checks a shared secret header, and can filter by trigger key.
 *
 * Example POST body from Protect:
 *   {
 *     "alarm": {
 *       "name": "test post",
 *       "sources": [],
 *       "conditions": [{ "condition": { "type": "is", "source": "motion" } }],
 *       "triggers": [{ "key": "motion", "device": "74ACB99F4E24" }]
 *     },
 *     "timestamp": 1722526793954
 *   }
 */
export class UniFiProtectTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'UniFi Protect Trigger',
		name: 'uniFiProtectTrigger',
		icon: 'file:unifiProtect.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '=Webhook ({{$parameter["httpMethod"]}})',
		description: 'Starts a workflow from a UniFi Protect alarm webhook',
		defaults: { name: 'UniFi Protect Trigger' },
		inputs: [],
		outputs: ['main'],
		webhooks: [
			{
				name: 'default',
				httpMethod: '={{$parameter["httpMethod"]}}',
				responseMode: 'onReceived',
				path: 'unifi-protect',
			},
		],
		properties: [
			{
				displayName:
					'Copy this node\'s <b>Production URL</b> (from the top of this panel) into UniFi Protect → Alarm Manager → add a Webhook action, and select the same HTTP method below.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'HTTP Method',
				name: 'httpMethod',
				type: 'options',
				options: [
					{ name: 'POST', value: 'POST' },
					{ name: 'GET', value: 'GET' },
				],
				default: 'POST',
				description: 'Must match the method you select in the Protect webhook configuration',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{ name: 'None', value: 'none' },
					{ name: 'Secret Header', value: 'header' },
				],
				default: 'none',
				description:
					'Protect webhooks are unauthenticated by default. Add a custom header in Protect and verify it here to reject spoofed requests.',
			},
			{
				displayName: 'Header Name',
				name: 'headerName',
				type: 'string',
				default: 'x-webhook-token',
				displayOptions: { show: { authentication: ['header'] } },
			},
			{
				displayName: 'Header Value',
				name: 'headerValue',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { authentication: ['header'] } },
				description: 'The exact value the incoming header must equal',
			},
			{
				displayName: 'Trigger Keys',
				name: 'triggerKeys',
				type: 'string',
				default: '',
				placeholder: 'motion,smartDetectZone,smartDetectLine',
				description:
					'Comma-separated trigger keys to accept (matched against alarm.triggers[].key). Leave empty to accept all alarms.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Ignore Empty Alarms',
						name: 'ignoreEmpty',
						type: 'boolean',
						default: false,
						description:
							'Whether to acknowledge but not trigger when the request has no alarm payload (e.g. health checks)',
					},
				],
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const response = this.getResponseObject();

		// --- optional shared-secret check -------------------------------------
		const authentication = this.getNodeParameter('authentication') as string;
		if (authentication === 'header') {
			const headerName = (this.getNodeParameter('headerName') as string).toLowerCase();
			const expected = this.getNodeParameter('headerValue') as string;
			const headers = this.getHeaderData() as IDataObject;
			if (!expected || headers[headerName] !== expected) {
				response.status(403).send('Forbidden');
				return { noWebhookResponse: true };
			}
		}

		// --- read payload (GET -> query, POST -> body) ------------------------
		const httpMethod = this.getNodeParameter('httpMethod') as string;
		const payload = (httpMethod === 'GET'
			? this.getQueryData()
			: this.getBodyData()) as IDataObject;

		const alarm = (payload?.alarm as IDataObject) ?? undefined;
		const options = this.getNodeParameter('options', {}) as IDataObject;

		if (options.ignoreEmpty && !alarm) {
			response.status(200).send('ignored: no alarm');
			return { noWebhookResponse: true };
		}

		// --- optional trigger-key filter --------------------------------------
		const triggerKeysParam = (this.getNodeParameter('triggerKeys', '') as string).trim();
		if (triggerKeysParam && alarm) {
			const allowed = triggerKeysParam
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			const triggers = (alarm.triggers as IDataObject[]) ?? [];
			const matched = triggers.some((t) => allowed.includes(t.key as string));
			if (!matched) {
				response.status(200).send('ignored: trigger key not matched');
				return { noWebhookResponse: true };
			}
		}

		return { workflowData: [this.helpers.returnJsonArray([payload ?? {}])] };
	}
}
