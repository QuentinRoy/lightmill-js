/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import pug from 'rollup-plugin-pug';
import babel from 'rollup-plugin-babel';
import sass from 'rollup-plugin-sass';

export default {
  input: 'src/index.js',
  output: {
    name: 'LightmillApp',
    globals: { 'pug-runtime': 'pugRuntime' },
    format: 'umd',
    file: './lightmill-app.js',
    sourcemap: true
  },
  plugins: [
    resolve(),
    commonjs(),
    sass({ output: true }),
    pug({ pugRuntime: 'pug-runtime' }),
    babel({ exclude: 'node_modules/**' })
  ],
  external: ['pug-runtime']
};
