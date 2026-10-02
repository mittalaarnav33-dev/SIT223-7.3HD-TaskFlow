'use strict';

/*
 * SIT223 7.3HD - ESLint quality configuration.
 *
 * Recommended rules detect common JavaScript mistakes.
 * Additional limits control complexity and nesting.
 * Browser and Node.js files use their respective global variables.
 */

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            'data/**',
            'dist/**',
            'reports/**'
        ]
    },
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'test/**/*.js', '*.js', 'scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: globals.node
        }
    },
    {
        files: ['public/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: globals.browser
        }
    },
    {
        files: ['**/*.js'],
        rules: {
            // Fail the quality stage when these limits are exceeded.
            complexity: ['error', 10],
            'max-depth': ['error', 3],
            'max-params': ['error', 4],
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error'
        }
    }
];
