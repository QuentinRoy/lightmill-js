/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';

export default {
  input: 'src/index.js',
  output: {
    format: 'umd',
    name: 'LightMillRunner',
    file: './lib/lightmill-runner.js',
    sourcemap: true,
    globals: {
      'lightmill-connection': 'LightMillConnection',
      'babel-runtime/regenerator': 'regeneratorRuntime'
    }
  },
  plugins: [
    resolve(),
    commonjs(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    })
  ],
  external: ['babel-runtime/regenerator', 'lightmill-connection']
};
