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
		orderRequester,
		transactionRequester,
	} = deps;

	return {
		sendRequest,
		paymentHandler,
		webhook,
	};

	async function _mangopayAuth(req) {
		const privateConfig = await _getConfig(req, true);

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

		return mangopay;
	}

	async function _getConfig(req, isPrivate) {
		const config = await configRequester.communicate(req)({
			type: '_getConfig',
			access: isPrivate ? 'private' : 'default',
		});
		return config;
	}

	async function _getTransaction(req, transactionId) {
		const transaction = await transactionRequester.communicate(req)({
			type: 'read',
			transactionId: transactionId,
		});
		return transaction;
	}

	// async function _updateTransaction(req, transactionId, args) {
	// 	const transaction = await transactionRequester.communicate(req)({
	// 		type: 'update',
	// 		transactionId,
	// 		...args,
	// 	});
	// 	return transaction;
	// }

	// async function _createTransition(req, transactionId, transitionName, data) {
	// 	const transaction = await transactionRequester.communicate(req)({
	// 		type: 'createTransition',
	// 		transactionId,
	// 		name: transitionName,
	// 		data,
	// 	});
	// 	return transaction;
	// }

	async function _getUser(req, userId) {
		const user = await userRequester.communicate(req)({
			type: 'read',
			userId: userId,
		});
		return user;
	}

	async function _getOrder(req, orderId) {
		const order = await orderRequester.communicate(req)({
			type: 'read',
			orderId: orderId,
		});
		return order;
	}

	async function _listOrders(req, args) {
		const order = await orderRequester.communicate(req)({
			type: 'list',
			page: 1,
			nbResultsPerPage: 1,
			orderBy: 'createdDate',
			order: 'desc',
			...args,
		});
		return order;
	}

	async function _createOrder(req, args) {
		const order = await orderRequester.communicate(req)({
			type: 'create',
			...args,
		});
		return order;
	}

	async function _createOrderLine(req, args) {
		const order = await orderRequester.communicate(req)({
			type: 'createLine',
			...args,
		});
		return order;
	}

	async function _updateTransaction(req, args) {
		const transaction = await transactionRequester.communicate(req)({
			type: 'update',
			...args,
		});
		return transaction;
	}

	// async function _createOrderMove(req, args) {
	// 	const order = await orderRequester.communicate(req)({
	// 		type: 'createMove',
	// 		...args,
	// 	});
	// 	return order;
	// }

	async function _userMangopayIds(req) {
		let mangopayUserIds;

		const currentUserId = getCurrentUserId(req);

		if (!req._matchedPermissions['integrations:read_write:mangopay']) {
			if (currentUserId) {
				const user = await _getUser(req, currentUserId);

				const payerId = _.get(
					user,
					'platformData._private.mangoPay.payer.id',
					undefined,
				);
				const ownerId = _.get(
					user,
					'platformData._private.mangoPay.owner.id',
					undefined,
				);

				mangopayUserIds = {
					payer: payerId ? parseInt(payerId) : undefined,
					owner: ownerId ? parseInt(ownerId) : undefined,
				};
			} else {
				throw createError(404, 'User not exist');
			}
		}

		return mangopayUserIds;
	}

	async function _invokeMangopayFn(mangopay, method, args, req) {
		try {
			// awaiting to handle error in catch block
			console.log(mangopay, args);
			return await _.invoke(mangopay, method, ...args); // promise
		} catch (err) {
			const errorMessage = 'Mangopay error';
			const errObject = { expose: true };

			const reveal = !(
				process.env.NODE_ENV === 'production' && req.env === 'live'
			);
			const errDetails = {
				mangopayMethod: method,
				mangopayError: err,
			};
			if (reveal) _.set(errObject, 'public', errDetails);

			throw createError(err.http_status_code, errorMessage, errObject);
		}
	}

	async function sendRequest(req) {
		const { method, args = [{}] } = req;

		const mangopay = await _mangopayAuth(req);

		if (typeof _.get(mangopay, method) !== 'function') {
			throw createError(400, 'Mangopay method not found', {
				public: { method },
			});
		}

		// Only some methods are available to every user and they can operate only with their userId
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
			'CardRegistrations.create',
			'CardRegistrations.update',
			'Cards.get',
			'Cards.update',
			'Cards.getTransactions',
			'Cards.getPreAuthorizations',
			'CardPreAuthorizations.get',
		];

		if (!req._matchedPermissions['integrations:read_write:mangopay']) {
			const mangopayUserInfo = await _userMangopayIds(req);

			if (
				typeof mangopayUserInfo !== 'undefined' &&
				(mangopayUserInfo.owner || mangopayUserInfo.payer)
			) {
				if (methodAllowed.includes(method)) {
					if (
						method === 'CardRegistrations.create' ||
						method === 'CardRegistrations.update'
					) {
						if (args[0].UserId) {
							if (
								args[0].UserId !== mangopayUserInfo.payer &&
								args[0].UserId !== mangopayUserInfo.owner
							) {
								throw createError(403, 'Not allowed');
							}
						} else {
							throw createError(
								400,
								'Mangopay args not acceptable',
							);
						}
					} else if (
						method === 'Cards.get' ||
						method === 'Cards.update' ||
						method === 'Cards.getTransactions' ||
						method === 'Cards.getPreAuthorizations'
					) {
						if (args[0]) {
							const cardId =
								method === 'Cards.update'
									? args[0].Id
									: args[0];
							const card = await mangopay.Cards.get(cardId);
							if (
								!card.UserId ||
								(Number(card.UserId) !==
									mangopayUserInfo.payer &&
									Number(card.UserId) !==
										mangopayUserInfo.owner)
							) {
								throw createError(403, 'Not allowed');
							}
						} else {
							throw createError(
								400,
								'Mangopay args not acceptable',
							);
						}
					} else if (method === 'CardPreAuthorizations.get') {
						const authorId = await (
							await mangopay.CardPreAuthorizations.get(args[0])
						).AuthorId;
						if (
							Number(authorId) !== mangopayUserInfo.payer &&
							Number(authorId) !== mangopayUserInfo.owner
						) {
							throw createError(
								404,
								'Preauthorization not found',
							);
						}
					} else {
						if (Array.isArray(args)) {
							if (
								(args[0] !== mangopayUserInfo.payer &&
									args[0] !== mangopayUserInfo.owner) ||
								(typeof mangopayUserInfo.payer ===
									'undefined' &&
									typeof mangopayUserInfo.owner ===
										'undefined')
							) {
								throw createError(
									404,
									'Mangopay user not found',
								);
							}
						} else {
							throw createError(
								400,
								'Mangopay args not acceptable',
							);
						}
					}
				} else {
					throw createError(403, 'Not allowed');
				}
			} else {
				throw createError(403, 'Not allowed');
			}
		}

		return await _invokeMangopayFn(mangopay, method, args, req);
	}

	async function paymentHandler(req) {
		const { method, args = [{}], rawHeaders } = req;

		const mangopay = await _mangopayAuth(req);
		const mangopayUserInfo = await _userMangopayIds(req);

		const methods = [
			'Custom.preauth',
			'Custom.preauthPayIn',
			'Custom.payIn',
			'Custom.payOut',
		];

		if (!methods.includes(method)) {
			throw createError(400, 'Custom mangopay method not found', {
				public: { method },
			});
		}

		const currentUserId = getCurrentUserId(req);

		if (method === 'Custom.preauth') {
			/*
				args = [{
					courier?: string,
					transactionId: string,
					payment: {
						secureModeReturnUrl: string;
					}
				}]
			*/
			const transaction = await _getTransaction(
				req,
				args[0].transactionId,
			);

			if (
				_.get(transaction, 'metadata.ip', null) === null ||
				_.get(transaction, 'metadata.browserData.ColorDepth', null) ===
					null ||
				_.get(transaction, 'metadata.browserData.ScreenWidth', null) ===
					null ||
				_.get(
					transaction,
					'metadata.browserData.ScreenHeight',
					null,
				) === null ||
				_.get(transaction, 'metadata.paymentMethod', null) === null
			) {
				throw createError(400, 'Some mangopay args missing');
			}

			if (
				transaction.takerId === currentUserId &&
				(transaction.status === 'draft' ||
					transaction.status === 'failedPreauth')
			) {
				const config = await _getConfig(req);
				const shippingFares = _.get(
					config,
					`custom.shipping.${args[0].courier || 'default'}`,
					{},
				);

				let shippingFare;

				if (transaction.assetType.isDefault) {
					const shippingFareFinded = shippingFares.find(
						fare =>
							fare.size ===
							_.get(
								transaction,
								'assetSnapshot.metadata.packagingSize',
								undefined,
							),
					);

					if (shippingFareFinded) {
						shippingFare = shippingFareFinded.price;
					} else throw createError(404, 'Shipping fare not founded');
				} else shippingFare = 0;

				let orderId;
				const listOrders = await _listOrders(req, {
					transactionId: transaction.id,
				});

				if (!Array.isArray(listOrders) || listOrders.length === 0) {
					const createOrder = await _createOrder(req, {
						transactionIds: args[0].transactionId,
					});

					if (shippingFare > 0) {
						await _createOrderLine(req, {
							orderId: createOrder.id,
							transactionId: transaction.id,
							payerId: transaction.takerId,
							payerAmount: shippingFare,
							receiverId: null,
							receiverAmount: null,
							platformAmount: shippingFare,
							currency: transaction.currency,
							platformData: {
								shipping: true,
							},
						});
					}

					orderId = createOrder.id;
				} else {
					orderId = listOrders[0].id;
				}

				const orderUpdated = await _getOrder(req, orderId);

				const paymentData = {
					AuthorId: mangopayUserInfo.payer,
					DebitedFunds: {
						Currency: transaction.currency,
						Amount: orderUpdated.amountRemaining,
					},
					Tag: transaction.id,
					Culture: 'IT',
					CardId: transaction.metadata.paymentMethod,
					SecureModeReturnURL: args[0].payment.secureModeReturnUrl,
					// StatementDescriptor: '',
					IpAddress: transaction.metadata.ip,
					BrowserInfo: {
						AcceptHeader: rawHeaders.accept,
						JavaEnabled: false,
						JavascriptEnabled: true,
						UserAgent: req._userAgent || rawHeaders['user-agent'],
						Language: rawHeaders['accept-language'].substring(0, 2),
						...transaction.metadata.browserData,
					},
					Shipping: {
						FirstName: transaction.metadata.firstName,
						LastName: transaction.metadata.lastName,
						Address: transaction.metadata.address,
					},
				};

				return await _invokeMangopayFn(
					mangopay,
					'CardPreAuthorizations.create',
					[paymentData],
					req,
				);
			} else {
				throw createError(403, 'Not allowed');
			}
		} else if (method === 'Custom.preauthPayIn') {
			/*
				args = [{
					transactionId: string;
				}]
			*/
			if (!_.get(args[0], 'transactionId', undefined)) {
				throw createError(400, 'Some mangopay args missing');
			}

			const transaction = await _getTransaction(
				req,
				args[0].transactionId,
			);

			if (
				!req._matchedPermissions['integrations:read_write:mangopay'] &&
				transaction.takerId !== currentUserId &&
				transaction.ownerId !== currentUserId
			) {
				throw createError(403, 'Not allowed');
			}

			if (
				transaction.status !== 'pending-payment' &&
				transaction.status !== 'failedPayin'
			) {
				throw createError(500, 'Wrong transaction status');
			}

			const escrowWallets = await mangopay.Users.getWallets(
				process.env.ESCROW_USER,
			);

			const escrowWallet = escrowWallets.find(wallet =>
				wallet.Description.toLowerCase().includes('escrow'),
			);

			const shippingWallet = escrowWallets.find(wallet =>
				wallet.Description.toLowerCase().includes('shipping'),
			);

			const preauthorization = await mangopay.CardPreAuthorizations.get(
				transaction.platformData.preauthorizationId,
			);

			console.log(transaction);
			const userTaker = await _getUser(req, transaction.takerId);

			const userTakerId = _.get(
				userTaker,
				'platformData._private.mangoPay.payer.id',
				undefined,
			);

			// PayIn to the escrow Wallet
			let escrowPayIn;

			if (preauthorization.RemainingFunds.Amount > 0) {
				escrowPayIn = await _invokeMangopayFn(
					mangopay,
					'PayIns.create',
					[
						{
							PaymentType: 'PREAUTHORIZED',
							ExecutionType: 'DIRECT',
							CreditedUserId: userTakerId,
							CreditedWalletId: escrowWallet.Id,
							DebitedFunds: {
								Currency: transaction.currency,
								Amount: preauthorization.RemainingFunds.Amount,
							},
							Fees: {
								Currency: transaction.currency,
								Amount: transaction.platformAmount,
							},
							PreauthorizationId: preauthorization.Id,
							Tag: transaction.id,
						},
					],
					req,
				);
			}

			const orders = await _listOrders(req, {
				transactionId: transaction.id,
			});

			const order = orders.results[0];
			const orderShippingLine = order.lines.find(
				line => _.get(line, 'platformData.shipping', false) === true,
			);

			if (
				orderShippingLine.platformAmount >
				_.get(transaction, 'platformData.transferToShipping', 0)
			) {
				const transfer = await mangopay.Transfers.create({
					AuthorId: process.env.ESCROW_USER,
					DebitedWalletId: escrowWallet.Id,
					CreditedWalletId: shippingWallet.Id,
					Fees: {
						Amount: 0,
						Currency: 'EUR',
					},
					DebitedFunds: {
						Currency: 'EUR',
						Amount:
							orderShippingLine.platformAmount -
							_.get(
								transaction,
								'platformData.transferToShipping',
								0,
							),
					},
				});

				const transferToShipping = _.get(
					transfer,
					'CreditedFunds.Amount',
					0,
				);

				await _updateTransaction(req, {
					transactionId: transaction.id,
					platformData: {
						transferToShipping:
							_.get(
								transaction,
								'platformData.transferToShipping',
								0,
							) + transferToShipping,
					},
				});
			}

			return await _invokeMangopayFn(
				mangopay,
				'PayIns.get',
				[escrowPayIn.Id],
				req,
			);
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
