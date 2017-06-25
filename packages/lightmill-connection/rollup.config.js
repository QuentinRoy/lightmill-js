/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';

export default {
  entry: 'src/index.js',
  format: 'umd',
  moduleName: 'LightMillConnection',
  plugins: [resolve(), commonjs(), babel({
    exclude: 'node_modules/**' // only transpile our source code
  })],
  external: ['babel-runtime/regenerator', 'unfetch'],
  dest: './lib/lightmill-connection.js',
  sourceMap: true,
  globals: {
    unfetch: 'unfetch',
    'babel-runtime/regenerator': 'regeneratorRuntime'
  }
};
