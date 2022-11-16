/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';
import async from 'rollup-plugin-async';

export default {
  input: 'esm/index',
  output: {
    format: 'umd',
    name: 'lightmill.Runner',
    file: './dist/lightmill-runner.js',
    sourcemap: true,
    globals: {
      'babel-runtime/regenerator': 'regeneratorRuntime',
    },
  },
  plugins: [
    resolve(),
    commonjs(),
    async(),
    babel({
      exclude: 'node_modules/**', // only transpile our source code
    }),
  ],
  external: ['babel-runtime/regenerator'],
};
