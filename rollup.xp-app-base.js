/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import pug from 'rollup-plugin-pug';
import babel from 'rollup-plugin-babel';
import sass from 'rollup-plugin-sass';

export default {
  entry: 'src/xp-app-base/index.js',
  format: 'umd',
  moduleName: 'XpAppBase',
  plugins: [
    resolve(),
    commonjs(),
    sass({ output: true }),
    pug({ pugRuntime: 'pug-runtime' }),
    babel({ exclude: 'node_modules/**' })
  ],
  external: ['pug-runtime'],
  globals: { 'pug-runtime': 'pugRuntime' },
  dest: './xp-app-base.js',
  sourceMap: true
};
