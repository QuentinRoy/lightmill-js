import fetch from 'unfetch';

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
// function is to deal with the different form that can be tacken by api path).
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
    { 'X-Requested-With': 'XMLHttpRequest' },
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
      'X-Requested-With': 'XMLHttpRequest'
    },
    options.headers
  );
  // Automatically stringify non string content if the content type is json.
  const body = typeof content !== 'string' && isJsonType(contentType)
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
 * @param       {String} serverAddress
 * @param       {String} [apiPath='api']
 * @constructor
 */
export default function ServerInterface(serverAddress, apiPath = 'api') {
  if (!(this instanceof ServerInterface)) {
    throw new Error('ServerInterface must be called with new');
  }

  // Init the api address once and for all.
  const apiAddress = getApiAddress(serverAddress, apiPath);
  // Get the address of an API endpoint on the server using either a simple string, or an
  // array.
  const getAddress = addrOrPathList =>
    (typeof addrOrPathList === 'string'
      ? [apiAddress, addrOrPathList]
      : [apiAddress, ...addrOrPathList]).join('/');
  const ask = (addrOrPathList, ...args) =>
    askServer(getAddress(addrOrPathList), ...args);
  const send = (addrOrPathList, ...args) =>
    sendToServer(getAddress(addrOrPathList), ...args);

  /**
   * Request the dictionary of available experiments.
   * @return {Promise<Object, Object>}
   */
  this.experiments = () => ask('experiments');

  /**
   * Request an available run description.
   * @param  {String} experimentId  the experiment id.
   * @return {Promise<Object, Object>}
   */
  this.availableRun = experimentId =>
    ask(['experiment', experimentId, 'available_run']);

  /**
   * Request the basic information about a run.
   * @param  {String} experimentId  the experiment id.
   * @param  {String} runId         the run id.
   * @return {Promise<Object, Object>}
   */
  this.run = (experimentId, runId) => ask(['run', experimentId, runId]);

  /**
   * Request the plan of a run (including blocks and trials).
   * @param  {String} experimentId  the experiment id.
   * @param  {String} runId         the run id.
   * @return {Promise<Object, Object>}
   */
  this.plan = (experimentId, runId) =>
    ask(['run', experimentId, runId, 'plan']);

  /**
   * Request a lock on a run.
   * @param  {String} experimentId  the experiment id.
   * @param  {String} runId         the run id.
   * @return {Promise<Object, Object>}
   */
  this.lock = (experimentId, runId) =>
    ask(['run', experimentId, runId, 'lock']);

  /**
   * Request the current trial of a run (last non completed trial).
   * @param  {String} experimentId  the experiment id.
   * @param  {String} runId         the run id.
   * @return {Promise<Object, Object>}
   */
  this.currentTrial = (experimentId, runId) =>
    ask(['run', experimentId, runId, 'current_trial']);

  /**
   * Post trial results (mark the current trial as completed on the server).
   * @param  {String} experimentId the experiment id.
   * @param  {String} runId        the run id.
   * @param  {int} blockNumber     the number of the block
   * @param  {int} trialNumber     the number of the trial
   * @param  {Object} result       the result of the trial.
   * @return {Promise<Object, Object>}
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
}