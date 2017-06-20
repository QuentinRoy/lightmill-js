import './templates/base.scss';
import crashTemplate from './templates/crash.pug';
import './templates/crash.scss';
import blockInitTemplate from './templates/block-init.pug';
import './templates/block-init.scss';
import endTemplate from './templates/end.pug';
import './templates/end.scss';
import waitTemplate from './templates/wait.pug';
import './templates/wait.scss';

const XP_APP_BASE_CLASSNAME = 'xp-app-base';

/**
 * Standard Experimentation App Base class. The app is higly reconfigurable and any method
 * can be safely replaced at any time. Cannot be used as is as it lacks a proper `runTrial`
 * method implementation.
 * @constructor
 * @abstract
 */
export default class StandardXpAppBase {
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
   * Must be overwriten by subclasses (or dynamically replaced).
   * @param {Object} config the trial configuration
   * @return {Promise<Object>} resolved with the trial results.
   * @abstract
   */
  runTrial() {
    throw new Error('XpApp.runTrial is not implemented');
  }

  /**
   * Show the wait view.
   * @param  {String} [message] The wait message.
   */
  wait(message) {
    this.node.innerHTML = waitTemplate({ message });
  }

  /**
   * By default start waiting when the app starts.
   */
  start() {
    return this.wait();
  }

  /**
   * Show the crash view.
   * @param  {String} message The error message.
   * @param  {Error} [error]  The error that has been raised.
   * @param  {Object} [run]   The current run.
   */
  crash(message, error, run) {
    this.node.innerHTML = crashTemplate({
      run,
      message,
      stack: error && error.stack
    });
    const detailsButton = this.node.querySelector('.details-button');
    detailsButton.addEventListener('click', evt => {
      evt.preventDefault();
      this.node.querySelector(`.${XP_APP_BASE_CLASSNAME}`).classList.toggle('with-details');
    });
  }

  /**
   * Show the block initialization view.
   * @param  {Object} blockInfo
   * @return {Promise}          Resolved when the user click/tap on the view.
   */
  initBlock(blockInfo) {
    return new Promise(resolve => {
      this.node.innerHTML = blockInitTemplate(blockInfo);
      const appNode = this.node.querySelector(`.${XP_APP_BASE_CLASSNAME}`);
      const listener = evt => {
        evt.preventDefault();
        appNode.removeEventListener('click', listener);
        resolve();
      };
      appNode.addEventListener('click', listener);
    }).then(res => {
      this.wait();
      return res;
    });
  }

  /**
   * Show the end view.
   */
  end() {
    this.node.innerHTML = endTemplate();
  }
}
