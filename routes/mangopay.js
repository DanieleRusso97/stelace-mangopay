const createService = require('../services/mangopay');

let mangopay;
let deps = {};

function init(server, { middlewares, helpers } = {}) {
	const { checkPermissions } = middlewares;
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
			ctx = Object.assign({}, ctx, { args, method });

			return mangopay.sendRequest(ctx);
		}),
	);

	server.post(
		{
			name: 'mangopay.webhooks',
			path: '/integrations/mangopay/webhooks/:publicPlatformId',
		},
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

	Object.assign(deps, {
		configRequester,
		userRequester,
	});

	mangopay = createService(deps);
}

function stop() {
	const { configRequester } = deps;

	configRequester.close();

	deps = null;
}

module.exports = {
	init,
	start,
	stop,
};
