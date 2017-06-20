/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import pug from 'rollup-plugin-pug';
import babel from 'rollup-plugin-babel';

export default {
  entry: 'src/standard-xp-app/index.js',
  format: 'umd',
  moduleName: 'StandardXpApp',
  plugins: [resolve(), commonjs(), pug(), babel({
    exclude: 'node_modules/**' // only transpile our source code
  })],
  external: ['babel-runtime/regenerator', 'spin'],
  dest: 'lib/standard-xp-app.js',
  sourceMap: true,
  globals: {
    spin: 'Spinner',
    'babel-runtime/regenerator': 'regeneratorRuntime'
  }
};
