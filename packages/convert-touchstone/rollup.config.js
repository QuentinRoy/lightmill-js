/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';

export default {
  input: 'esm/index.js',
  output: {
    format: 'umd',
    name: 'LightMillConvertTouchstone',
    file: './dist/lightmill-convert-touchstone.js',
    sourcemap: true,
    globals: { sax: 'sax' }
  },
  plugins: [
    resolve(),
    commonjs(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    })
  ],
  external: ['sax']
};
