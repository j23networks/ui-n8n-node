import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

interface LegacySession {
	cookie: string;
	csrfToken: string;
}

/**
 * Legacy sessions are cached per host for the lifetime of the Node.js process so
 * we only log in once across many items / executions. UniFi session cookies are
 * long-lived JWTs, so this is safe; on auth failure callers clear the cache.
 */
const legacySessions = new Map<string, LegacySession>();

// ---------------------------------------------------------------------------
// Official UniFi Network API (https://{host}/proxy/network/integration)
// ---------------------------------------------------------------------------

export async function unifiApiRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('unifiApi');

	const options: IHttpRequestOptions = {
		method,
		url: `https://${credentials.host}/proxy/network/integration${endpoint}`,
		body,
		qs,
		json: true,
		skipSslCertificateValidation: credentials.allowUnauthorizedCerts as boolean,
	};

	if (Object.keys(body).length === 0) delete options.body;
	if (Object.keys(qs).length === 0) delete options.qs;

	return this.helpers.httpRequestWithAuthentication.call(this, 'unifiApi', options);
}

/**
 * Walks the official API's offset/limit pagination envelope
 * ({ offset, limit, count, totalCount, data }) and returns the flattened list.
 */
export async function unifiApiRequestAllItems(
	this: Ctx,
	endpoint: string,
	qs: IDataObject = {},
	limit = 200,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let offset = 0;
	let totalCount = Infinity;

	do {
		const response = await unifiApiRequest.call(this, 'GET', endpoint, {}, { ...qs, offset, limit });
		const page = (response.data as IDataObject[]) ?? [];
		items.push(...page);
		totalCount = (response.totalCount as number) ?? items.length;
		offset += limit;
		if (page.length === 0) break;
	} while (items.length < totalCount);

	return items;
}

// ---------------------------------------------------------------------------
// UniFi Protect API (https://{host}/proxy/protect/integration)
// Note: the published spec mislabels its server as the Network base; the real
// Protect integration base is /proxy/protect/integration. Auth is the same key.
// ---------------------------------------------------------------------------

export async function unifiProtectRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('unifiApi');

	const options: IHttpRequestOptions = {
		method,
		url: `https://${credentials.host}/proxy/protect/integration${endpoint}`,
		body,
		qs,
		json: true,
		skipSslCertificateValidation: credentials.allowUnauthorizedCerts as boolean,
	};

	if (Object.keys(body).length === 0) delete options.body;
	if (Object.keys(qs).length === 0) delete options.qs;

	return this.helpers.httpRequestWithAuthentication.call(this, 'unifiApi', options);
}

/** Protect list endpoints return a plain array; normalize to an array of items. */
export async function unifiProtectRequestAllItems(
	this: Ctx,
	endpoint: string,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const response = await unifiProtectRequest.call(this, 'GET', endpoint, {}, qs);
	if (Array.isArray(response)) return response as IDataObject[];
	if (Array.isArray((response as IDataObject)?.data)) return (response as IDataObject).data as IDataObject[];
	return [response as IDataObject];
}

/** Fetches a binary resource (e.g. a camera snapshot) and returns the raw bytes. */
export async function unifiProtectBinary(
	this: Ctx,
	endpoint: string,
	qs: IDataObject = {},
): Promise<{ buffer: Buffer; contentType: string }> {
	const credentials = await this.getCredentials('unifiApi');

	const response = await this.helpers.httpRequestWithAuthentication.call(this, 'unifiApi', {
		method: 'GET',
		url: `https://${credentials.host}/proxy/protect/integration${endpoint}`,
		qs: Object.keys(qs).length ? qs : undefined,
		encoding: 'arraybuffer',
		returnFullResponse: true,
		skipSslCertificateValidation: credentials.allowUnauthorizedCerts as boolean,
	});

	const contentType = ((response.headers as IDataObject)['content-type'] as string) ?? 'image/jpeg';
	return { buffer: Buffer.from(response.body as ArrayBuffer), contentType };
}

// ---------------------------------------------------------------------------
// Legacy controller API (https://{host}/proxy/network/api/...)
// ---------------------------------------------------------------------------

async function getLegacySession(this: Ctx, force = false): Promise<LegacySession> {
	const credentials = await this.getCredentials('unifiApi');
	const host = credentials.host as string;

	if (!credentials.username || !credentials.password) {
		throw new NodeOperationError(
			this.getNode(),
			'This action uses the UniFi legacy API, which needs a local account. Add a Local Username and Local Password to your UniFi credential.',
			{ description: 'The official UniFi Network API does not expose this capability.' },
		);
	}

	const cached = legacySessions.get(host);
	if (cached && !force) return cached;

	const response = await this.helpers.httpRequest({
		method: 'POST',
		url: `https://${host}/api/auth/login`,
		body: {
			username: credentials.username,
			password: credentials.password,
			rememberMe: true,
		},
		json: true,
		returnFullResponse: true,
		skipSslCertificateValidation: credentials.allowUnauthorizedCerts as boolean,
	});

	const rawCookies = response.headers['set-cookie'] ?? [];
	const cookieList = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
	const cookie = cookieList.map((c: string) => c.split(';')[0]).join('; ');

	const csrfToken = (response.headers['x-csrf-token'] ??
		response.headers['x-updated-csrf-token'] ??
		'') as string;

	if (!cookie) {
		throw new NodeOperationError(
			this.getNode(),
			'Legacy login to UniFi succeeded but returned no session cookie. Check the host and that the account is a local (not Ubiquiti SSO) account.',
		);
	}

	const session: LegacySession = { cookie, csrfToken };
	legacySessions.set(host, session);
	return session;
}

export async function unifiLegacyRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('unifiApi');

	const run = async (session: LegacySession) => {
		const options: IHttpRequestOptions = {
			method,
			url: `https://${credentials.host}/proxy/network${endpoint}`,
			body,
			qs,
			json: true,
			skipSslCertificateValidation: credentials.allowUnauthorizedCerts as boolean,
			headers: {
				Cookie: session.cookie,
				'X-CSRF-Token': session.csrfToken,
			},
		};
		if (Object.keys(body).length === 0) delete options.body;
		if (Object.keys(qs).length === 0) delete options.qs;
		return this.helpers.httpRequest(options);
	};

	let session = await getLegacySession.call(this);
	try {
		return await run(session);
	} catch (error) {
		// Session may have expired — log in once more before giving up.
		if ((error as { statusCode?: number }).statusCode === 401) {
			legacySessions.delete(credentials.host as string);
			session = await getLegacySession.call(this, true);
			return run(session);
		}
		throw error;
	}
}

// ---------------------------------------------------------------------------
// Cross-API identifier resolution (this is what makes the fallback transparent)
// ---------------------------------------------------------------------------

/**
 * The official API keys sites by `id`; the legacy API keys them by a short code
 * exposed on the official site object as `internalReference`. This maps one to
 * the other so the user only ever picks an official site.
 */
export async function resolveSiteInternalRef(this: Ctx, siteId: string): Promise<string> {
	const sites = await unifiApiRequestAllItems.call(this, '/v1/sites');
	const match = sites.find((s) => s.id === siteId);
	if (!match) {
		throw new NodeOperationError(this.getNode(), `Could not find a site with id "${siteId}".`);
	}
	return match.internalReference as string;
}

/** Devices are matched across APIs by MAC. Returns the MAC for an official device id. */
export async function getDeviceMac(this: Ctx, siteId: string, deviceId: string): Promise<string> {
	const device = await unifiApiRequest.call(
		this,
		'GET',
		`/v1/sites/${siteId}/devices/${deviceId}`,
	);
	return device.macAddress as string;
}

/** Looks up the full legacy device record (incl. `_id` and `port_overrides`) by MAC. */
export async function resolveLegacyDevice(
	this: Ctx,
	siteRef: string,
	mac: string,
): Promise<IDataObject> {
	const response = await unifiLegacyRequest.call(this, 'GET', `/api/s/${siteRef}/stat/device`);
	const devices = (response.data as IDataObject[]) ?? [];
	const device = devices.find(
		(d) => (d.mac as string)?.toLowerCase() === mac.toLowerCase(),
	);
	if (!device) {
		throw new NodeOperationError(
			this.getNode(),
			`Could not find device ${mac} in the legacy controller for this site.`,
		);
	}
	return device;
}

/**
 * Read-modify-write of a single port's override entry on a switch via the legacy
 * API. This is the mechanism behind all per-port config (PoE mode, VLAN, etc.)
 * that the official API does not support.
 */
export async function setLegacyPortOverride(
	this: Ctx,
	siteId: string,
	deviceId: string,
	portIdx: number,
	patch: IDataObject,
): Promise<any> {
	const siteRef = await resolveSiteInternalRef.call(this, siteId);
	const mac = await getDeviceMac.call(this, siteId, deviceId);
	const device = await resolveLegacyDevice.call(this, siteRef, mac);

	const overrides = ((device.port_overrides as IDataObject[]) ?? []).map((o) => ({ ...o }));
	let entry = overrides.find((o) => o.port_idx === portIdx);
	if (!entry) {
		entry = { port_idx: portIdx };
		overrides.push(entry);
	}
	Object.assign(entry, patch);

	return unifiLegacyRequest.call(this, 'PUT', `/api/s/${siteRef}/rest/device/${device._id}`, {
		port_overrides: overrides,
	});
}

/** Runs a device-manager command (adopt, upgrade, etc.) against a switch by MAC. */
export async function legacyDeviceCommand(
	this: Ctx,
	siteId: string,
	mac: string,
	command: IDataObject,
): Promise<any> {
	const siteRef = await resolveSiteInternalRef.call(this, siteId);
	return unifiLegacyRequest.call(this, 'POST', `/api/s/${siteRef}/cmd/devmgr`, {
		mac,
		...command,
	});
}
