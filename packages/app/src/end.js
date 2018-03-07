/* eslint-disable no-param-reassign */

import endTemplate from './views/end.pug';

export default node => {
  node.innerHTML = endTemplate();

  return {
    remove() {
      node.innerHTML = '';
    }
  };
};
