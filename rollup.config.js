import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import pug from 'rollup-plugin-pug';
import babel from 'rollup-plugin-babel';

export default {
  entry: 'src/index.js',
  format: 'umd',
  moduleName: 'XpClient',
  plugins: [resolve(), commonjs(), pug(), babel({
    exclude: 'node_modules/**' // only transpile our source code
  })],
  external: ['pug', 'fetch-ponyfill', 'javascript-state-machine'],
  dest: 'lib/xpclient.js',
  sourceMap: true,
  globals: {
    'javascript-state-machine': 'StateMachine',
    'fetch-ponyfill': 'fetchPonyfill'
  }
};
