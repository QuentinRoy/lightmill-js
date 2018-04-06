/* eslint-disable no-param-reassign */

import { XP_APP_BASE_CLASS_NAME } from './commons';
import crashTemplate from './views/crash.pug';
import './views/crash.scss';

/**
 * Show the crash view.
 * @param  {HTMLElement} node The node where to mount the view.
 * @param  {String} message The error message.
 * @param  {Error} [error] The error that has been raised.
 * @param  {Object} [run] The current run.
 * @returns {undefined}
 */
export default (node, message, error, run) => {
  node.innerHTML = crashTemplate({
    run,
    message,
    stack: error && error.stack
  });
  const detailsButton = node.querySelector('.lightmill-details-button');
  detailsButton.addEventListener('click', evt => {
    evt.preventDefault();
    node
      .querySelector(`.${XP_APP_BASE_CLASS_NAME}`)
      .classList.toggle('lightmill-with-details');
  });
  return {
    remove() {
      node.innerHTML = '';
    }
  };
};
