/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import pug from 'rollup-plugin-pug';
import babel from 'rollup-plugin-babel';
import sass from 'rollup-plugin-sass';

export default {
  entry: 'src/standard-xp-app/index.js',
  format: 'umd',
  moduleName: 'StandardXpApp',
  plugins: [
    resolve(),
    commonjs(),
    sass({ output: true }),
    pug(),
    babel({ exclude: 'node_modules/**' })
  ],
  dest: 'lib/standard-xp-app.js',
  sourceMap: true
};
