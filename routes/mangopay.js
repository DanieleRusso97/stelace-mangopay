const createService = require('../services/mangopay');

let mangopay;
let deps = {};

function init(server, { middlewares, helpers } = {}) {
	const { checkPermissions, restifyAuthorizationParser } = middlewares;
	const { wrapAction, getRequestContext } = helpers;

	server.post(
		{
			name: 'mangopay.pluginRequest',
			path: '/integrations/mangopay/request',
		},
		checkPermissions(['integrations:read_write:mangopay', 'token:check']),
		wrapAction(async (req, res) => {
			let ctx = getRequestContext(req);

			const { args, method } = req.body;
			ctx = Object.assign({}, ctx, { args, method, rawHeaders: req.headers });

			return mangopay.sendRequest(ctx);
		}),
	);

	server.post(
		{
			name: 'mangopay.paymentHandler',
			path: '/integrations/mangopay/payment',
		},
		checkPermissions([
			'integrations:read_write:mangopay',
			'transaction:create',
		]),
		wrapAction(async (req, res) => {
			let ctx = getRequestContext(req);

			const { args, method } = req.body;
			ctx = Object.assign({}, ctx, {
				args,
				method,
				rawHeaders: req.headers,
			});

			return mangopay.paymentHandler(ctx);
		}),
	);

	server.get(
		{
			name: 'mangopay.webhooks',
			path: '/integrations/mangopay/webhooks/:publicPlatformId',
			manualAuth: true,
		},
		restifyAuthorizationParser,
		wrapAction(async (req, res) => {
			const { publicPlatformId } = req.params;

			return mangopay.webhook({
				_requestId: req._requestId,
				publicPlatformId,
				rawBody: req.query,
				deps,
			});
		}),
	);
}

function start(startParams) {
	deps = Object.assign({}, startParams);

	const {
		communication: { getRequester },
	} = deps;

	const configRequester = getRequester({
		name: 'Mangopay service > Config Requester',
		key: 'config',
	});

	const userRequester = getRequester({
		name: 'Mangopay service > User Requester',
		key: 'user',
	});

	const orderRequester = getRequester({
		name: 'Mangopay service > Order Requester',
		key: 'order',
	});

	const transactionRequester = getRequester({
		name: 'Mangopay service > Transaction Requester',
		key: 'transaction',
	});

	const assetRequester = getRequester({
		name: 'Mangopay service > Transaction Requester',
		key: 'asset',
	});

	const entryRequester = getRequester({
		name: 'Mangopay service > Entry Requester',
		key: 'entry',
	});

	const taskRequester = getRequester({
		name: 'Mangopay service > Task Requester',
		key: 'task',
	});

	Object.assign(deps, {
		configRequester,
		userRequester,
		orderRequester,
		transactionRequester,
		assetRequester,
		entryRequester,
		taskRequester,
	});

	mangopay = createService(deps);
}

function stop() {
	const {
		configRequester,
		userRequester,
		orderRequester,
		transactionRequester,
		assetRequester,
		entryRequester,
		taskRequester,
	} = deps;

	configRequester.close();
	userRequester.close();
	orderRequester.close();
	transactionRequester.close();
	assetRequester.close();
	entryRequester.close();
	taskRequester.close();

	deps = null;
}

module.exports = {
	init,
	start,
	stop,
};
