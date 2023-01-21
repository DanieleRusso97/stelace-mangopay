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
		assetRequester,
		// orderRequester,
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

	async function _getAsset(req, assetId) {
		const asset = await assetRequester.communicate(req)({
			type: 'read',
			assetId: assetId,
		});
		return asset;
	}

	async function _updateAsset(req, assetId, args) {
		const asset = await assetRequester.communicate(req)({
			type: 'update',
			assetId,
			...args,
		});
		return asset;
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

	async function _updateUser(req, userId, args) {
		const user = await userRequester.communicate(req)({
			type: 'update',
			userId,
			...args,
		});
		return user;
	}

	// async function _getOrder(req, orderId) {
	// 	const order = await orderRequester.communicate(req)({
	// 		type: 'read',
	// 		orderId: orderId,
	// 	});
	// 	return order;
	// }

	// async function _listOrders(req, args) {
	// 	const order = await orderRequester.communicate(req)({
	// 		type: 'list',
	// 		page: 1,
	// 		nbResultsPerPage: 1,
	// 		orderBy: 'createdDate',
	// 		order: 'desc',
	// 		...args,
	// 	});
	// 	return order;
	// }

	// async function _createOrder(req, args) {
	// 	const order = await orderRequester.communicate(req)({
	// 		type: 'create',
	// 		...args,
	// 	});
	// 	return order;
	// }

	// async function _createOrderLine(req, args) {
	// 	const order = await orderRequester.communicate(req)({
	// 		type: 'createLine',
	// 		...args,
	// 	});
	// 	return order;
	// }

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
			'Wallets.get',
			'PayIns.get',
			'PayOuts.create',
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
					} else if (method === 'Wallets.get') {
						const wallet = await mangopay.Wallets.get(args[0]);
						const walletOwner = wallet.Owners[0];
						if (
							Number(walletOwner) !== mangopayUserInfo.payer &&
							Number(walletOwner) !== mangopayUserInfo.owner
						) {
							throw createError(403, 'Not allowed');
						}
					} else if (method === 'PayIns.get') {
						const payin = await mangopay.PayIns.get(args[0]);
						const payinOwner = payin.AuthorId;
						if (
							Number(payinOwner) !== mangopayUserInfo.payer &&
							Number(payinOwner) !== mangopayUserInfo.owner
						) {
							throw createError(403, 'Not allowed');
						}
					} else if (method === 'PayOuts.create') {
						const user = await _getUser(req, getCurrentUserId(req));
						if (args[0].AuthorId) {
							if (
								args[0].AuthorId !== mangopayUserInfo.owner ||
								args[0].DebitedWalletId !==
									_.get(
										user,
										'platformData._private.mangoPay.owner.walletId',
									)
							) {
								throw createError(403, 'Not allowed');
							}
						} else {
							throw createError(
								400,
								'Mangopay args not acceptable',
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

	async function _getShippingFare(args, req) {
		/*
				args = {
					packagingSize: 'SMALL' | 'MEDIUM' | 'LARGE';
					enabled?: boolean;
					courier?: string;
				}
			*/
		const config = await _getConfig(req);
		const shippingFares = _.get(
			config,
			`custom.shipping.${args.courier || 'default'}`,
			{},
		);

		let shippingFare;

		if (!args.packagingSize) {
			throw createError(404, 'Packaging size not founded');
		}

		if (args.enabled) {
			const shippingFareFinded = shippingFares.find(
				fare => fare.size === args.packagingSize,
			);
			if (shippingFareFinded) {
				shippingFare = shippingFareFinded.price;
			} else throw createError(404, 'Shipping fare not founded');
		} else shippingFare = 0;

		return shippingFare;
	}

	async function _getEscrowWallets(mangopay, req) {
		const escrowWallets = await mangopay.Users.getWallets(
			process.env.ESCROW_USER,
		);
		const escrowWallet = escrowWallets.find(wallet =>
			wallet.Description.toLowerCase().includes('escrow'),
		);
		const shippingWallet = escrowWallets.find(wallet =>
			wallet.Description.toLowerCase().includes('shipping'),
		);

		return { escrow: escrowWallet, shipping: shippingWallet };
	}

	async function paymentHandler(req) {
		const { method, args = [{}], rawHeaders } = req;

		const mangopay = await _mangopayAuth(req);
		const mangopayUserInfo = await _userMangopayIds(req);

		const methods = [
			'Custom.refundPayIns',
			'Custom.payIn',
			'Custom.payOut',
			'Custom.transferToShipping',
			'Custom.transferToOwner',
			'Custom.sponsorProduct',
			'Custom.updateAssetForAdv',
			'Custom.stopAdv',
		];

		if (!methods.includes(method)) {
			throw createError(400, 'Custom mangopay method not found', {
				public: { method },
			});
		}

		const currentUserId = getCurrentUserId(req);

		if (method === 'Custom.payIn') {
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

			if (transaction.status !== 'draft') {
				throw createError(400, 'Wrong transaction status');
			}

			if (transaction.takerId === currentUserId) {
				const shippingFare = await _getShippingFare(
					{
						courier: args[0].courier,
						enabled: transaction.assetType.isDefault,
						packagingSize: _.get(
							transaction,
							'assetSnapshot.metadata.packagingSize',
							undefined,
						),
					},
					req,
				);

				await _updateTransaction(req, {
					transactionId: transaction.id,
					platformData: {
						shippingFare: shippingFare,
						transferToShipping: shippingFare,
					},
				});

				const userTaker = await _getUser(req, transaction.takerId);

				const userTakerId = _.get(
					userTaker,
					'platformData._private.mangoPay.payer.id',
					undefined,
				);

				const { escrow: escrowWallet } = await _getEscrowWallets(
					mangopay,
					req,
				);

				const totalAmount = transaction.takerAmount + shippingFare;

				const paymentData = {
					AuthorId: mangopayUserInfo.payer,
					CreditedUserId: userTakerId,
					CreditedWalletId: escrowWallet.Id,
					DebitedFunds: {
						Currency: transaction.currency,
						Amount: totalAmount,
					},
					Fees: {
						Currency: transaction.currency,
						Amount: transaction.platformAmount,
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
					'PayIns.create',
					[paymentData],
					req,
				);
			} else {
				throw createError(403, 'Not allowed');
			}
		} else if (method === 'Custom.refundPayIns') {
			/*
				args = [{
					payinIds: string[];
				}]
			*/
			if (!req._matchedPermissions['integrations:read_write:mangopay']) {
				throw createError(403, 'Not allowed');
			}

			const payinIds = _.get(args[0], 'payinIds', []);

			if (_.isEmpty(payinIds)) {
				throw createError(400, 'Some mangopay args missing');
			}

			const payinRefunds = [];

			for (const payinId of payinIds) {
				const payinRefund = await mangopay.PayIns.createRefund(
					payinId,
					{
						AuthorId: process.env.ESCROW_USER,
					},
				);
				payinRefunds.push(payinRefund);
			}

			return payinRefunds;
		} else if (method === 'Custom.transferToShipping') {
			/*
				args = [{
					transactionId: string;
				}]
			*/
			const transaction = await _getTransaction(
				req,
				args[0].transactionId,
			);

			const wallets = await _getEscrowWallets(mangopay, req);
			const transferToShipping = _.get(
				transaction,
				'platformData.transferToShipping',
				0,
			);

			const transfer = await mangopay.Transfers.create({
				AuthorId: process.env.ESCROW_USER,
				DebitedWalletId: wallets.escrow.Id,
				CreditedWalletId: wallets.shipping.Id,
				Fees: {
					Amount: 0,
					Currency: 'EUR',
				},
				DebitedFunds: {
					Currency: 'EUR',
					Amount: transferToShipping,
				},
			});

			const amountTransfered = _.get(transfer, 'CreditedFunds.Amount', 0);

			await _updateTransaction(req, {
				transactionId: transaction.id,
				platformData: {
					transferToShipping: transferToShipping - amountTransfered,
				},
			});

			return await _getTransaction(req, args[0].transactionId);
		} else if (method === 'Custom.transferToOwner') {
			/*
				args = [{
					transactionId: string;
				}]
			*/

			if (!req._matchedPermissions['integrations:read_write:mangopay']) {
				throw createError(403, 'Not allowed');
			}

			const transaction = await _getTransaction(
				req,
				args[0].transactionId,
			);

			if (
				_.get(transaction, 'platformData.completedTransfer', false) ===
				true
			) {
				throw createError(500, 'Transfer already done');
			}

			const transferToOwner = transaction.ownerAmount || 0;
			const wallets = await _getEscrowWallets(mangopay, req);
			const ownerUser = await _getUser(req, transaction.ownerId);

			const ownerWallet = _.get(
				ownerUser,
				'platformData._private.mangoPay.owner.walletId',
			);

			const transfer = await mangopay.Transfers.create({
				AuthorId: process.env.ESCROW_USER,
				DebitedWalletId: wallets.escrow.Id,
				CreditedWalletId: ownerWallet,
				Fees: {
					Amount: 0,
					Currency: 'EUR',
				},
				DebitedFunds: {
					Currency: 'EUR',
					Amount: transferToOwner,
				},
			});

			const amountTransfered = _.get(transfer, 'CreditedFunds.Amount', 0);

			if (amountTransfered === transferToOwner) {
				await _updateTransaction(req, {
					transactionId: transaction.id,
					platformData: {
						completedTransfer: true,
					},
				});
			}

			await _updateUser(req, ownerUser.id, {
				platformData: {
					balance: {
						pending:
							_.get(
								ownerUser,
								'platformData._private.balance.pending',
								0,
							) - amountTransfered,
					},
				},
			});

			return await _getTransaction(req, args[0].transactionId);
		} else if (method === 'Custom.sponsorProduct') {
			/*
				args = [{
					assetIds: string[],
					timings: {
						days: number;
					},
					payment: {
						secureModeReturnUrl: string;
					},
					browserData: {
						AcceptHeader?: string;
						JavaEnabled?: boolean;
						Language?: string;
						ColorDepth: number;
						ScreenHeight: number;
						ScreenWidth: number;
						TimeZoneOffset: number;
						UserAgent?: string;
						JavascriptEnabled?: boolean;
					},
					ip: string;
					paymentMethod?: string;
				}]
			*/
			if (
				_.get(args[0], 'assetIds', []).length === 0 ||
				!args[0].timings
			) {
				throw createError(400, 'Some mangopay args missing');
			}

			const assets = args[0].assetIds.map(
				async assetId => await _getAsset(req, assetId),
			);

			if (
				assets.some(asset => asset.ownerId !== currentUserId) &&
				!req._matchedPermissions['integrations:read_write:mangopay']
			) {
				throw createError(403, 'Cannot sponsor article of other users');
			}

			const { escrow: escrowWallet } = await _getEscrowWallets(
				mangopay,
				req,
			);

			const config = await _getConfig(req);
			const advInfo = config.custom.adv.find(advProd =>
				_.isEqual(advProd.timings, args[0].timings),
			);

			if (!advInfo) {
				throw createError(404, "This type of adv doesn't exist");
			}

			const price = advInfo.price * assets.length;

			const user = await _getUser(req, currentUserId);

			let paymentMethod;
			if (!args[0].paymentMethod) {
				const paymentMethods = _.get(
					user,
					'metadata._private.paymentMethods',
					[],
				);

				if (paymentMethods.length === 0) {
					throw createError(
						404,
						'No payment methods founded for the current user',
					);
				}

				paymentMethod = paymentMethods[0].id;
			} else {
				paymentMethod = args[0].paymentMethod;
			}

			const paymentData = {
				AuthorId: mangopayUserInfo.payer,
				CreditedWalletId: escrowWallet.Id,
				DebitedFunds: {
					Currency: 'EUR',
					Amount: 0,
				},
				Fees: {
					Currency: 'EUR',
					Amount: price,
				},
				Tag: JSON.stringify({
					assets: args[0].assetIds,
					timings: args[0].timings,
				}),
				Culture: 'IT',
				CardId: paymentMethod,
				SecureModeReturnURL: args[0].payment.secureModeReturnUrl,
				// StatementDescriptor: '',
				IpAddress: args[0].ip,
				BrowserInfo: {
					AcceptHeader: rawHeaders.accept,
					JavaEnabled: false,
					JavascriptEnabled: true,
					UserAgent: req._userAgent || rawHeaders['user-agent'],
					Language: rawHeaders['accept-language'].substring(0, 2),
					...args[0].browserData,
				},
			};

			return await _invokeMangopayFn(
				mangopay,
				'PayIns.create',
				[paymentData],
				req,
			);
		} else if (method === 'Custom.updateAssetForAdv') {
			/*
				args = [{
					assetIds: string[],
					timings: {
						days: number;
					},
					payinId: string;
				}]
			*/

			if (!req._matchedPermissions['integrations:read_write:mangopay']) {
				throw createError(403, 'Not allowed');
			}

			if (
				!Array.isArray(args[0].assetIds) ||
				args[0].assetIds.length === 0 ||
				!args[0].timings ||
				!args[0].payinId
			) {
				throw createError(400, 'Some mangopay args missing');
			}

			const assetIds = args[0].assetIds.filter(el => el);

			const now = new Date().getTime();
			const endDate = now + args[0].timings.days * 1000 * 60 * 60 * 24;

			for (const assetId of assetIds) {
				await _updateAsset(req, assetId, {
					customAttributes: {
						sponsored: true,
					},
					platformData: {
						adv: {
							active: true,
							lastPayinId: args[0].payinId,
							from: now,
							to: endDate,
						},
					},
				});
			}

			const assets = assetIds.map(
				async assetId => await _getAsset(req, assetId),
			);

			return {
				assets,
				endDate,
			};
		} else if (method === 'Custom.stopAdv') {
			/*
				args = [{
					assetIds: string[],
				}]
			*/
			if (!req._matchedPermissions['integrations:read_write:mangopay']) {
				throw createError(403, 'Not allowed');
			}

			if (
				!Array.isArray(args[0].assetIds) ||
				args[0].assetIds.length === 0
			) {
				throw createError(400, 'Some mangopay args missing');
			}

			const assetIds = args[0].assetIds.filter(el => el);

			for (const assetId of assetIds) {
				const asset = await _getAsset(req, assetId);

				const now = new Date().getTime();

				const endDate = _.get(asset, 'platformData.adv.to', undefined);

				if (!endDate || now > endDate) {
					await _updateAsset(req, assetId, {
						customAttributes: {
							sponsored: false,
						},
						platformData: {
							adv: {
								active: false,
								lastPayinId: args[0].payinId,
								from: now,
								to: endDate,
							},
						},
					});
				}
			}

			const assets = assetIds.map(
				async assetId => await _getAsset(req, assetId),
			);

			return assets;
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

		console.log(platformId, env, {
			type,
			objectId: event.id,
			emitterId: 'mangopay',
			metadata: event,
		});

		const evtReq = await stelaceApiRequest('/events', {
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

		return { success: true, req: evtReq };
	}
};
