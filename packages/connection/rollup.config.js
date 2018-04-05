/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import async from 'rollup-plugin-async';
import babel from 'rollup-plugin-babel';

export default {
  input: 'esm/index.js',
  output: {
    format: 'umd',
    name: 'LightMillConnection',
    sourcemap: true,
    globals: {
      unfetch: 'unfetch',
      'babel-runtime/regenerator': 'regeneratorRuntime'
    },
    exports: 'named',
    file: './dist/lightmill-connection.js'
  },
  plugins: [
    resolve(),
    commonjs(),
    async(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    })
  ],
  external: ['babel-runtime/regenerator', 'unfetch']
};
