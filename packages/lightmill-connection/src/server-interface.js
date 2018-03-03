import fetch from 'unfetch';

/**
 * Check if the target experiment is loaded on the server.
 * @param  {Object}  serverInterface the server interface.
 * @param  {string}  experimentId    the id of the target experiment.
 * @return {Promise}                 true if the experiment is loaded on the server.
 */
export async function isExperimentLoadedOnServer(
  serverInterface,
  experimentId
) {
  const experiments = await serverInterface.experiments();
  return !!experiments[experimentId];
}

/**
 * Fetch the given experiment design xml file and post it to be imported on the server.
 * @param  {Object}  serverInterface      the server interface.
 * @param  {string}  experimentDesignAddr the address where to download the experiment design.
 * @return {Promise}                      resolves when the experiment has been imported.
 */
export async function importExperimentOnServer(
  serverInterface,
  experimentDesignAddr
) {
  const designReq = await fetch(experimentDesignAddr);
  const design = await designReq.text();
  return serverInterface.postExperimentDesign(design);
}

// Check if a given xhr type is a json type.
const isJsonType = type => type.endsWith('json');

// Fetch an address, expecting a json answer, and throwing if the requests failed.
const jsonThrowingFetch = (...args) =>
  fetch(...args).then(resp => {
    if (resp.ok) {
      // Every response are supposed to be json.
      return resp.json();
    }
    // If the requests has failed, throw an error.
    return resp.json().then(
      errorDescr => {
        const e = new Error(errorDescr.message);
        e.type = errorDescr.type;
        throw e;
      },
      () => {
        throw new Error(resp.statusText);
      }
    );
  });

// From a server address and the path to an API, return the api address (the main point of this
// function is to deal with the different form that can be taken by api path).
function getApiAddress(serverAddress, apiPath) {
  if (typeof apiPath === 'string') {
    return [serverAddress, apiPath].join('/');
  } else if (apiPath) {
    return [serverAddress, ...apiPath].join('/');
  }
  return serverAddress;
}

// Ask data to a server.
function askServer(address, options = {}) {
  // Create the request header (all requests are xhr).
  const headers = Object.assign(
    { Accept: 'application/json' },
    options.headers
  );
  // Create the options for fetch.
  const fetchOptions = Object.assign({ cache: 'no-cache' }, options, {
    headers
  });
  // Fetch.
  return jsonThrowingFetch(address, fetchOptions);
}

// Send data to a server.
function sendToServer(
  address,
  content,
  contentType = 'application/json',
  options = {}
) {
  // Set up the request headers, the content type and the request as xhr.
  const headers = Object.assign(
    {
      'Content-Type': contentType,
      Accept: 'application/json'
    },
    options.headers
  );
  // Automatically stringify non string content if the content type is json.
  const body =
    typeof content !== 'string' && isJsonType(contentType)
      ? JSON.stringify(content)
      : content;
  // Create the options for fetch.
  const fetchOptions = Object.assign({ method: 'POST', body }, options, {
    headers
  });
  // Fetch.
  return jsonThrowingFetch(address, fetchOptions);
}

/**
 * An interface toward the web xp server.
 * @param {String} serverAddress The address of the server.
 * @param {String} [apiPath='api'] The path toward the server API.
 * @constructor
 */
export default function ServerInterface(serverAddress, apiPath = 'api') {
  if (!(this instanceof ServerInterface)) {
    throw new Error('ServerInterface must be called with new');
  }

  // Init the api address once and for all.
  const apiAddress = getApiAddress(serverAddress, apiPath);
  // Get the address of an API endpoint on the server using either a simple
  // string, or an array.
  const getAddress = addrOrPathList =>
    (typeof addrOrPathList === 'string'
      ? [apiAddress, addrOrPathList]
      : [apiAddress, ...addrOrPathList]
    ).join('/');
  const ask = (addrOrPathList, ...args) =>
    askServer(getAddress(addrOrPathList), ...args);
  const send = (addrOrPathList, ...args) =>
    sendToServer(getAddress(addrOrPathList), ...args);

  /**
   * @return {Promise<Object, Object>} A promise that resolves with a
   * dictionary of the available experiments.
   */
  this.experiments = () => ask('experiments');

  /**
   * @param {String} experimentId  the experiment id.
   * @return {Promise<Object, Object>} A promise that resolves with the
   * description of an available run.
   */
  this.availableRun = experimentId =>
    ask(['experiment', experimentId, 'available_run']);

  /**
   * Request the basic information about a run.
   * @param  {String} experimentId The experiment id.
   * @param  {String} runId The run id.
   * @return {Promise} A promise that resolves with the
   * description of a run.
   */
  this.run = (experimentId, runId) => ask(['run', experimentId, runId]);

  /**
   * Request the plan of a run.
   * @param  {String} experimentId The experiment id.
   * @param  {String} runId The run id.
   * @return {Promise} A promise that resolves with the plan of
   * a run (including blocks and trials).
   */
  this.plan = (experimentId, runId) =>
    ask(['run', experimentId, runId, 'plan']);

  /**
   * Request a lock on a run.
   * @param  {String} experimentId The experiment id.
   * @param  {String} runId The run id.
   * @return {Promise} A promise that resolves with the run's lock.
   */
  this.lock = (experimentId, runId) =>
    ask(['run', experimentId, runId, 'lock']);

  /**
   * Request the current trial of a run (last non completed trial).
   * @param  {String} experimentId The experiment id.
   * @param  {String} runId The run id.
   * @return {Promise} A promise that resolves with the current (not yet
   * resolved) trial.
   */
  this.currentTrial = (experimentId, runId) =>
    ask(['run', experimentId, runId, 'current_trial']);

  /**
   * Post trial results (mark the current trial as completed on the server).
   * @param  {String} experimentId The experiment id.
   * @param  {String} runId The run id.
   * @param  {int} blockNumber The number of the block
   * @param  {int} trialNumber The number of the trial
   * @param  {Object} result The result of the trial.
   * @return {Promise} A promise that resolves one the trial results has been
   * recorded on the server.
   */
  this.postTrialResults = (
    experimentId,
    runId,
    blockNumber,
    trialNumber,
    result
  ) => send(['trial', experimentId, runId, blockNumber, trialNumber], result);
  this.postExperimentDesign = expeDesign =>
    send('import', expeDesign, 'text/xml');

  /**
   * Check if the target experiment is loaded on the server.
   * @param  {string}  experimentId the id of the target experiment.
   * @return {Promise} A promise that resolves with true if the experiment is
   * loaded on the server.
   */
  this.isExperimentLoadedOnServer = experimentId =>
    isExperimentLoadedOnServer(this, experimentId);

  /**
   * Fetch the given experiment design xml file and post it to be imported on
   * the server.
   * @param  {string}  experimentDesignAddr the address where to download the
   * experiment design.
   * @return {Promise} A promise that resolves when the experiment has been
   * imported.
   */
  this.importExperimentOnServer = experimentDesignAddr =>
    importExperimentOnServer(this, experimentDesignAddr);
}
