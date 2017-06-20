/* eslint-disable import/no-extraneous-dependencies */
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';

export default {
  entry: 'src/xp-client/index.js',
  format: 'umd',
  moduleName: 'XpClient',
  plugins: [resolve(), commonjs(), babel({
    exclude: 'node_modules/**' // only transpile our source code
  })],
  external: ['unfetch', 'babel-runtime/regenerator'],
  dest: './xpclient.js',
  sourceMap: true,
  globals: {
    unfetch: 'unfetch',
    'babel-runtime/regenerator': 'regeneratorRuntime'
  }
};
