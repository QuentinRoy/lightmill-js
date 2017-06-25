/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';

export default {
  entry: 'src/index.js',
  format: 'umd',
  moduleName: 'LightMillRunner',
  plugins: [resolve(), commonjs(), babel({
    exclude: 'node_modules/**' // only transpile our source code
  })],
  external: ['babel-runtime/regenerator', 'lightmill-connection'],
  dest: './lib/lightmill-runner.js',
  sourceMap: true,
  globals: {
    'lightmill-connection': 'LightMillConnection',
    'babel-runtime/regenerator': 'regeneratorRuntime'
  }
};
