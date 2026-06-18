/**
 * ESLint config for an n8n community node package.
 * Uses eslint-plugin-n8n-nodes-base to enforce the conventions n8n expects
 * (and that the npm community-node verification checks).
 */
module.exports = {
	root: true,
	env: {
		browser: true,
		es6: true,
		node: true,
	},
	parser: '@typescript-eslint/parser',
	parserOptions: {
		sourceType: 'module',
	},
	ignorePatterns: ['.eslintrc.js', '**/*.js', 'node_modules/**', 'dist/**'],
	overrides: [
		{
			files: ['./credentials/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/credentials'],
			rules: {
				// This rule wants documentationUrl camelCased and, per its own docs, is
				// "Only applicable to nodes in the main repository." For a community
				// package documentationUrl must be a full HTTP URL (enforced by the
				// -not-http-url rule), so the camelCase rule is disabled here.
				'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			},
		},
		{
			files: ['./nodes/**/*.ts'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			extends: ['plugin:n8n-nodes-base/nodes'],
			rules: {
				// These rules statically introspect the `options` arrays of resource/
				// operation params. Our params are registry-generated and spread into
				// the arrays (e.g. ...GENERIC_RESOURCE_OPTIONS), which the rules cannot
				// parse — they throw on the spread elements. Disabled for this package.
				'n8n-nodes-base/node-param-resource-with-plural-option': 'off',
				'n8n-nodes-base/node-param-operation-without-no-data-expression': 'off',
				'n8n-nodes-base/node-param-options-type-unsorted-items': 'off',
			},
		},
	],
};
