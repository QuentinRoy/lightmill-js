/* eslint-disable no-param-reassign */

import endTemplate from './views/end.pug';
import './views/end.scss';

export default node => {
  node.innerHTML = endTemplate();

  return {
    remove() {
      node.innerHTML = '';
    }
  };
};
