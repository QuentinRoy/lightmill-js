/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';
import async from 'rollup-plugin-async';

export default {
  input: 'esm/index.js',
  output: {
    format: 'umd',
    name: 'LightMillRunner',
    file: './dist/lightmill-runner.js',
    sourcemap: true,
    globals: {
      '@lightmill/connection': 'LightMillConnection',
      'babel-runtime/regenerator': 'regeneratorRuntime'
    }
  },
  plugins: [
    resolve(),
    commonjs(),
    async(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    })
  ],
  external: ['babel-runtime/regenerator', '@lightmill/connection']
};
