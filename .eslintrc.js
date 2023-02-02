module.exports = {
	env: {
		node: true,
	},

	extends: 'standard',
	plugins: ['standard', 'promise'],

	rules: {
		'comma-dangle': 'off',
		indent: ['error', 'tab', 4],
		'no-tabs': 'off',
		'space-before-function-paren': 0,
		semi: ['error', 'always'],
	},
};
