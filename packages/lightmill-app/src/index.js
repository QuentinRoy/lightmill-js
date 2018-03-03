import './templates/base.scss';
import crashTemplate from './templates/crash.pug';
import './templates/crash.scss';
import blockInitTemplate from './templates/block-init.pug';
import './templates/block-init.scss';
import endTemplate from './templates/end.pug';
import './templates/end.scss';
import waitTemplate from './templates/wait.pug';
import './templates/wait.scss';

/**
 * @typedef {Object} BlockInfo
 * @property {int} blockInfo.number The number of the block.
 * @property {int} blockInfo.measuredBlockNum The number of the block amongst
 * non practice blocks.
 * @property {boolean} blockInfo.practice If it is a practice block.
 * @property {Array<{factor:{name}, name}>} blockInfo.factorValues The list of
 * factor values.
 * @property {boolean} blockInfo.subjectiveAssessment If subjective assessment should be
 * asked for.
 */

const XP_APP_BASE_CLASSNAME = 'xp-app-base';

/**
 * Standard Experimentation App Base class for lightmill-client providing wait, crash, end and
 * initBlock views. This is an abstract class that does not provide a `runTrial` handle
 * (required by xp-client). It is meant to be inherited (or monkey patched).
 * The app is highly reconfigurable and any method can be safely replaced at any time.
 * @constructor
 * @abstract
 */
export default class XpAppBase {
  /**
   * @param  {HTMLElement} node The node where to user for the app.
   */
  constructor(node) {
    /**
     * The node where lives the app (read-only).
     * @type {HTMLElement}
     */
    Object.defineProperty(this, 'node', { value: node });
  }

  /**
   * Must be overwritten by subclasses (or dynamically replaced).
   * @param {Object} config the trial configuration
   * @return {Promise<Object>} resolved with the trial results.
   * @abstract
   */
  runTrial() {
    throw new Error('runTrial not implemented');
  }

  /**
   * Show the wait view.
   * @param  {HTMLElement} node The node where to mount the view.
   * @param  {String} [message] The wait message.
   * @returns {undefined}
   */
  static wait(node, message) {
    // eslint-disable-next-line no-param-reassign
    node.innerHTML = waitTemplate({ message });
  }

  /**
   * Show the wait view.
   * @returns {undefined}
   */
  wait() {
    this.constructor.wait(this.node);
  }

  /**
   * By default start waiting when the app starts.
   * @returns {undefined}
   */
  start() {
    this.wait();
  }

  /**
   * Show the crash view.
   * @param  {HTMLElement} node The node where to mount the view.
   * @param  {String} message The error message.
   * @param  {Error} [error] The error that has been raised.
   * @param  {Object} [run] The current run.
   * @returns {undefined}
   */
  static crash(node, message, error, run) {
    // eslint-disable-next-line no-param-reassign
    node.innerHTML = crashTemplate({
      run,
      message,
      stack: error && error.stack
    });
    const detailsButton = node.querySelector('.details-button');
    detailsButton.addEventListener('click', evt => {
      evt.preventDefault();
      node
        .querySelector(`.${XP_APP_BASE_CLASSNAME}`)
        .classList.toggle('with-details');
    });
  }

  /**
   * Show the crash view.
   * @param  {String} message The error message.
   * @param  {Error} [error]  The error that has been raised.
   * @param  {Object} [run]   The current run.
   * @returns {undefined}
   */
  crash(message, error, run) {
    this.constructor.crash(this.node, message, error, run);
  }

  /**
   * Show the block initialization view.
   * @param {HTMLElement} node The node where to mount the view.
   * @param {BlockInfo} blockInfo Information about the block.
   * @return {Promise} Resolved when the user click/tap on the view.
   */
  static initBlock(node, blockInfo) {
    return new Promise(resolve => {
      // eslint-disable-next-line no-param-reassign
      node.innerHTML = blockInitTemplate(blockInfo);
      const appNode = node.querySelector(`.${XP_APP_BASE_CLASSNAME}`);
      const listener = evt => {
        evt.preventDefault();
        appNode.removeEventListener('click', listener);
        resolve();
      };
      appNode.addEventListener('click', listener);
    });
  }

  /**
   * Show the block initialization view then show the wait view.
   * @param {BlockInfo} blockInfo Information about the block.
   * @return {Promise} Resolved when the user click/tap on the view.
   */
  initBlock(blockInfo) {
    return this.constructor.initBlock(this.node, blockInfo).then(res => {
      this.wait();
      return res;
    });
  }

  /**
   * Show the end view.
   * @param {HTMLElement} node The node where to mount the view.
   * @returns {undefined}
   */
  static end(node) {
    // eslint-disable-next-line no-param-reassign
    node.innerHTML = endTemplate();
  }

  /**
   * Show the end view.
   * @returns {undefined}
   */
  end() {
    this.constructor.end(this.node);
  }
}
