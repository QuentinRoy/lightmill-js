/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';

export default {
  input: 'src/index.js',
  output: {
    format: 'umd',
    name: 'LightMillConnection',
    sourcemap: true,
    globals: {
      unfetch: 'unfetch',
      'babel-runtime/regenerator': 'regeneratorRuntime'
    },
    exports: 'named',
    file: './lib/lightmill-connection.js'
  },
  plugins: [
    resolve(),
    commonjs(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    })
  ],
  external: ['babel-runtime/regenerator', 'unfetch']
};