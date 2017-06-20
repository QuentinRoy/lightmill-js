import Spinner from 'spin';
import crashTemplate from './crash.pug';
import blockInitTemplate from './block-init.pug';
import endTemplate from './end.pug';

const SPINNER_CONFIG = {
  lines: 13, // The number of lines to draw
  length: 28, // The length of each line
  width: 14, // The line thickness
  radius: 42, // The radius of the inner circle
  scale: 1, // Scales overall size of the spinner
  corners: 1, // Corner roundness (0..1)
  color: '#000', // #rgb or #rrggbb or array of colors
  opacity: 0.25, // Opacity of the lines
  rotate: 0, // The rotation offset
  direction: 1, // 1: clockwise, -1: counterclockwise
  speed: 1, // Rounds per second
  trail: 60, // Afterglow percentage
  fps: 20, // Frames per second when using setTimeout() as a fallback for CSS
  zIndex: 2e9, // The z-index (defaults to 2000000000)
  className: 'spinner', // The CSS class to assign to the spinner
  top: '50%', // Top position relative to parent
  left: '50%', // Left position relative to parent
  shadow: false, // Whether to render a shadow
  hwaccel: false, // Whether to use hardware acceleration
  position: 'absolute' // Element positioning
};

/**
 * Standard Experimentation App Base class. The app is higly reconfigurable and any method
 * can be safely replaced at any time. Cannot be used as is as it lacks a proper `runTrial`
 * method implementation.
 * @param {HTMLElement} parentNode  The node where to mount the app.
 * @constructor
 * @abstract
 */
export default function StandardXpAppBase(node) {
  if (!(this instanceof StandardXpAppBase)) {
    throw new Error('StandardXpAppBase must be called with new');
  }
  const spinner = new Spinner(SPINNER_CONFIG);
  /**
   * The node where lives the app (read-only).
   * @type {HTMLElement}
   */
  Object.defineProperty(this, 'node', { value: node });

  /**
   * Show the wait view.
   */
  this.wait = () => {
    spinner.spin(this.node);
  };
}

// StandardXpAppBase's prototype
Object.assign(StandardXpAppBase.prototype, {
  /**
   * Must be overwriten by subclasses (or dynamically replaced).
   * @param {Object} config the trial configuration
   * @return {Promise<Object>} resolved with the trial results.
   * @abstract
   */
  runTrial() {
    throw new Error('XpApp.runTrial is not implemented');
  },

  /**
   * Start spinning while the experiment is loading.
   */
  start() {
    return this.wait();
  },

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
      this.node.querySelector('.details').style.display = 'inherit';
      detailsButton.style.display = 'none';
    });
  },

  /**
   * Show the block initialization view.
   * @param  {Object} blockInfo
   * @return {Promise}          Resolved when the user click/tap on the view.
   */
  initBlock(blockInfo) {
    return new Promise(resolve => {
      this.node.innerHTML = blockInitTemplate(blockInfo);
      const listener = evt => {
        evt.preventDefault();
        this.node.removeEventLister('click', listener);
        resolve();
      };
      this.node.addEventListener('click', listener);
    }).then(res => {
      this.wait();
      return res;
    });
  },

  /**
   * Show the end view.
   */
  end() {
    this.node.innerHTML = endTemplate();
  }
});
