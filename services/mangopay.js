const Mangopay = require('mangopay2-nodejs-sdk');
const debug = require('debug')('stelace:integrations:mangopay');
const _ = require('lodash');
const { parsePublicPlatformId } = require('stelace-util-keys');

module.exports = function createService(deps) {
	const {
		createError,
		communication: { stelaceApiRequest },

		getCurrentUserId,
		userRequester,
		configRequester,
	} = deps;

	return {
		sendRequest,
		webhook,
	};

	async function sendRequest(req) {
		const { env, method, args = [{}] } = req;

		const privateConfig = await configRequester.communicate(req)({
			type: '_getConfig',
			access: 'private',
		});

		const { KEY, CLIENT_ID, URI } = _.get(
			privateConfig,
			'stelace.integrations.mangopay',
			{},
		);
		if (!KEY) {
			throw createError(403, 'Mangopay secret API key not configured');
		}

		const mangopay = new Mangopay({
			clientId: CLIENT_ID,
			clientApiKey: KEY,
			// Set the right production API url. If testing, omit the property since it defaults to sandbox URL
			baseUrl: URI,
		});

		if (typeof _.get(mangopay, method) !== 'function') {
			throw createError(400, 'Mangopay method not found', {
				public: { method },
			});
		}

		// Only some methods are available to every user and they can operate only with their userId

		// Everyone of these methods have userId as first parameters, so args[0] will be userId
		const methodAllowed = [
			'Users.createBankAccount',
			'Users.getBankAccount',
			'Users.createKycDocument',
			'Users.getKycDocuments',
			'Users.updateKycDocument',
			'Users.createKycPage',
			'Users.createKycPageFromFile',
			'Users.getEMoney',
			'UboDeclarations.create',
			'UboDeclarations.createUbo',
			'UboDeclarations.get',
			'UboDeclarations.getAll',
			'UboDeclarations.getUbo',
			'UboDeclarations.update',
			'UboDeclarations.updateUbo',
		];

		const currentUserId = getCurrentUserId(req);

		console.log(currentUserId);

		if (currentUserId) {
			const user = await userRequester.communicate(req)({
				type: 'read',
				userId: currentUserId,
			});

			const mangopayUserInfo = {
				payer:
					parseInt(user.platformData._private.mangoPay.payer.id) ||
					undefined,
				owner:
					parseInt(user.platformData._private.mangoPay.owner.id) ||
					undefined,
			};
			console.log('mango pay user info: ', mangopayUserInfo);

			if (methodAllowed.includes(method)) {
				if (Array.isArray(args)) {
					if (
						(args[0] !== mangopayUserInfo.payer &&
							args[0] !== mangopayUserInfo.owner) ||
						(typeof mangopayUserInfo.payer === 'undefined' &&
							typeof mangopayUserInfo.owner === 'undefined')
					) {
						throw createError(404, 'Mangopay user not found');
					}
				} else throw createError(400, 'Mangopay args not acceptable');
			} else if (
				!req._matchedPermissions['integrations:read_write:mangopay']
			) {
				throw createError(403, 'Not allowed');
			}
		} else if (
			!req._matchedPermissions['integrations:read_write:mangopay']
		) {
			throw createError(403, 'Not allowed');
		}

		try {
			// awaiting to handle error in catch block
			console.log(args);
			return await _.invoke(mangopay, method, ...args); // promise
		} catch (err) {
			const errorMessage = 'Mangopay error';
			const errObject = { expose: true };

			const reveal = !(
				process.env.NODE_ENV === 'production' && env === 'live'
			);
			const errDetails = {
				mangopayMethod: method,
				mangopayError: err,
			};
			if (reveal) _.set(errObject, 'public', errDetails);

			throw createError(err.http_status_code, errorMessage, errObject);
		}
	}

	async function webhook({ _requestId, rawBody, publicPlatformId }) {
		debug('Webhook integration: webhook event %O', rawBody);

		const { hasValidFormat, platformId, env } =
			parsePublicPlatformId(publicPlatformId);
		if (!hasValidFormat) throw createError(403);

		if (_.isEmpty(rawBody)) {
			throw createError(400, 'Event object body expected');
		}

		const req = {
			_requestId,
			platformId,
			env,
		};

		// const privateConfig = await configRequester.communicate(req)({
		// type: '_getConfig',
		// access: 'private',
		// });
		//
		// const { KEY, CLIENT_ID, URI } = _.get(
		// privateConfig,
		// 'stelace.integrations.mangopay',
		// {},
		// );
		// if (!KEY) {
		// throw createError(403, 'Mangopay API key not configured');
		// }
		//
		// const mangopay = new Mangopay({
		// clientId: CLIENT_ID,
		// clientApiKey: KEY,
		// // Set the right production API url. If testing, omit the property since it defaults to sandbox URL
		// baseUrl: URI,
		// });

		const event = {
			id: req._requestId,
			type: rawBody.EventType,
			resource: rawBody.RessourceId,
			timestamp: rawBody.Date,
		};

		// Verify Mangopay webhook signature
		// https://mangopay.com/docs/webhooks/signatures
		// try {
		// event = mangopay.webhooks.constructEvent(
		// rawBody,
		// mangopaySignature,
		// webhookSecret,
		// );
		// } catch (err) {
		// throw createError(403);
		// }

		// prefix prevents overlapping with other event types
		const type = `mangopay_${event.type}`;
		const params = {
			type,
			orderBy: 'createdDate',
			order: 'desc',
			page: 1,
		};

		const { results: sameEvents } = await stelaceApiRequest('/events', {
			platformId,
			env,
			payload: {
				objectId: event.id,
				nbResultsPerPage: 1,
				...params,
			},
		});

		// Stripe webhooks may send same events multiple times
		// https://mangopay.com/docs/webhooks/best-practices#duplicate-events
		if (sameEvents.length) {
			debug(
				'Stripe integration: idempotency check with event id: %O',
				sameEvents,
			);
		}

		await stelaceApiRequest('/events', {
			platformId,
			env,
			method: 'POST',
			payload: {
				// https://mangopay.com/docs/api/events/types
				// No Stripe event name currently has two underscores '__', which would cause an error
				type,
				objectId: event.id, // just a convention to easily retrieve events, objectId being indexed
				emitterId: 'mangopay',
				metadata: event,
			},
		});

		return { success: true };
	}
};
