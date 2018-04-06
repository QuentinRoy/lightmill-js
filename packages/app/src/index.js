import end from './end';
import initBlock from './block-init';
import crash from './crash';
import wait from './wait';

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

/**
 * Standard Experimentation App Base class for lightmill-client providing wait, crash, end and
 * initBlock views. This is an abstract class that does not provide a `runTrial` handle
 * (required by xp-client). It is meant to be inherited (or monkey patched).
 * The app is highly reconfigurable and any method can be safely replaced at any time.
 * @constructor
 * @abstract
 */
class XpAppBase {
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
   * @returns {undefined}
   */
  wait() {
    wait(this.node);
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
   * @param  {String} message The error message.
   * @param  {Error} [error]  The error that has been raised.
   * @param  {Object} [run]   The current run.
   * @returns {undefined}
   */
  crash(message, error, run) {
    crash(this.node, message, error, run);
  }

  /**
   * Show the block initialization view then show the wait view.
   * @param {BlockInfo} blockInfo Information about the block.
   * @return {Promise} Resolved when the user click/tap on the view.
   */
  initBlock(blockInfo) {
    return initBlock(this.node, blockInfo).then(res => {
      this.wait();
      return res;
    });
  }

  /**
   * Show the end view.
   * @returns {undefined}
   */
  end() {
    end(this.node);
  }
}

// Set up static the view handlers as static property of XpAppBase for
// cjs.
Object.assign(XpAppBase, { end, initBlock, crash, wait });

export { end, initBlock, crash, wait };
