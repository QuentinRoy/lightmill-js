/* eslint-disable no-param-reassign */

import { XP_APP_BASE_CLASS_NAME } from './commons';
import blockInitTemplate from './views/block-init.pug';
import './views/block-init.scss';

/**
 * Show the block initialization view.
 * @param {HTMLElement} node The node where to mount the view.
 * @param {BlockInfo} blockInfo Information about the block.
 * @return {Promise} Resolved when the user click/tap on the view.
 */
export default (node, blockInfo) => {
  let remove;
  const promise = new Promise(resolve => {
    node.innerHTML = blockInitTemplate(blockInfo);
    const appNode = node.querySelector(`.${XP_APP_BASE_CLASS_NAME}`);

    const done = evt => {
      evt.preventDefault();
      remove();
    };

    remove = () => {
      appNode.removeEventListener('click', done);
      node.innerHTML = '';
      resolve();
    };

    appNode.addEventListener('click', done);
  });
  promise.remove = remove;
  return promise;
};
