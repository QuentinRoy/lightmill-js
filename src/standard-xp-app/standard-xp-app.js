import StandardXpAppBase from './standard-xp-app-base';

/**
 * Create a standard xp application.
 * The application relies on simple handlers to show the experiment progress. If the handlers
 * return a promise, the promise is used to pause the experiment until it returns (e.g. the time
 * a trial is run).
 * All handlers work on the same node and usually entirely clears it before proceeding.
 * @type {Object}
 */
export default class StandardXpApp extends StandardXpAppBase {
  /**
   * @param  {HTMLElement} node                   The node where to mount the application.
   * @param  {function|Object} runTrialOrHandlers The runTrial function or a dictionary of handlers
   *                                              to overwrite.
   */
  constructor(node, runTrialOrHandlers) {
    super(node);
    // Overwrite handlers.
    const handlers = typeof runTrial === 'function'
      ? { runTrial: runTrialOrHandlers }
      : runTrialOrHandlers;
    Object.assign(this, handlers);
  }
}
