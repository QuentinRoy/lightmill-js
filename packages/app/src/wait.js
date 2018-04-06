/* eslint-disable no-param-reassign */

import waitTemplate from './views/wait.pug';
import './views/wait.scss';

export default (node, message) => {
  node.innerHTML = waitTemplate({ message });

  return {
    remove() {
      node.innerHTML = '';
    }
  };
};
