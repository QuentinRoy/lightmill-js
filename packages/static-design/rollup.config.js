/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';

export default {
  input: 'esm/index',
  output: {
    format: 'umd',
    name: 'lightmill.staticDesign',
    file: './dist/lightmill-static-design.js',
    sourcemap: true,
    exports: 'named'
  },
  plugins: [
    resolve(),
    commonjs(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    })
  ]
};
