import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * A single credential that powers BOTH transports used by the UniFi node:
 *
 *  - The official UniFi Network API (https://{host}/proxy/network/integration)
 *    authenticated with an API key sent in the `X-API-Key` header.
 *
 *  - The legacy controller API (https://{host}/proxy/network/api/...) which only
 *    accepts a local-account session (username + password -> cookie + CSRF token).
 *
 * The API key is required. The local account is optional and is only needed for
 * operations that the official API does not expose (e.g. setting PoE mode,
 * adopting/forgetting devices). The node tells the user when it is missing.
 */
export class UniFiApi implements ICredentialType {
	name = 'unifiApi';

	displayName = 'UniFi API';

	documentationUrl = 'https://developer.ui.com';

	properties: INodeProperties[] = [
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: '',
			required: true,
			placeholder: '192.168.1.1 or unifi.example.com',
			description:
				'Hostname or IP of your UniFi console/gateway. Do not include the protocol or a path.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'API key from your UniFi console (Settings → Control Plane → Integrations / API). Used for the official UniFi Network API.',
		},
		{
			displayName: 'Local Account (for legacy-only actions)',
			name: 'localAccountNotice',
			type: 'notice',
			default: '',
			description:
				'Some actions are not available in the official API and use the legacy controller API, which needs a local UniFi account. Leave blank if you only use official-API actions.',
		},
		{
			displayName: 'Local Username',
			name: 'username',
			type: 'string',
			default: '',
			description: 'Local UniFi account username. Only required for legacy-API actions.',
		},
		{
			displayName: 'Local Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Local UniFi account password. Only required for legacy-API actions.',
		},
		{
			displayName: 'Ignore SSL Issues (self-signed certificates)',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: true,
			description:
				'Whether to connect even if the console uses a self-signed certificate (common for local UniFi consoles)',
		},
	];

	/**
	 * Injects the API key for official-API requests made through
	 * httpRequestWithAuthentication. Legacy requests build their own auth and do
	 * not use this block.
	 */
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '=https://{{$credentials.host}}/proxy/network/integration',
			url: '/v1/info',
			skipSslCertificateValidation: '={{$credentials.allowUnauthorizedCerts}}',
		},
	};
}
