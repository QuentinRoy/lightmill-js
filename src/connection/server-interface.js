import fetch from 'unfetch';

const isJsonType = type => type.endsWith('json');

// Fetch an address, expecting a json answer, and throwing if the requests failed.
const jsonThrowingFetch = (...args) =>
  fetch(...args).then((resp) => {
    if (resp.ok) {
      // Every response are supposed to be json.
      return resp.json();
    }
    // If the requests has failed, throw an error.
    return resp.json().then(
      (errorDescr) => {
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
const getApiAddress = (serverAddress, apiPath) => {
  if (typeof apiPath === 'string') {
    return [serverAddress, apiPath].join('/');
  } else if (apiPath) {
    return [serverAddress, ...apiPath].join('/');
  }
  return serverAddress;
};

// Returns an interface toward the provided server address.
export default function getServerInterface(serverAddress, apiPath = 'api') {
  // Init the api address once and for all.
  const apiAddress = getApiAddress(serverAddress, apiPath);

  // Get the address of an API endpoint on the server using either a simple string, or an
  // array.
  const getAddress = addrOrPathList =>
    (typeof addrOrPathList === 'string'
      ? [apiAddress, addrOrPathList]
      : [apiAddress, ...addrOrPathList]).join('/');

  // Ask data to the server.
  const ask = (addrOrPathList, options = {}) => {
    // Create the request header (all requests are xhr).
    const headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, options.headers);
    // Create the options for fetch.
    const fetchOptions = Object.assign({ cache: 'no-cache' }, options, { headers });
    // Fetch.
    return jsonThrowingFetch(getAddress(addrOrPathList), fetchOptions);
  };

  // Send data to the server.
  const send = (addrOrPathList, content, contentType = 'application/json', options = {}) => {
    // Set up the request headers, the content type and the request as xhr.
    const headers = Object.assign(
      {
        'Content-Type': contentType,
        'X-Requested-With': 'XMLHttpRequest'
      },
      options.headers
    );
    // Automatically stringify non string content if the content type is json.
    const body =
      typeof content !== 'string' && (isJsonType(contentType) ? JSON.stringify(content) : content);
    // Create the options for fetch.
    const fetchOptions = Object.assign({ method: 'POST', body }, options, { headers });
    // Fetch.
    return jsonThrowingFetch(getAddress(addrOrPathList), fetchOptions);
  };

  return {
    experiments: () => ask('experiments'),
    availableRun: xpId => ask(['experiment', xpId, 'available_run']),
    run: (xpId, runId) => ask(['run', xpId, runId]),
    plan: (xpId, runId) => ask(['run', xpId, runId, 'plan']),
    lock: (xpId, runId) => ask(['run', xpId, runId, 'lock']),
    currentTrial: (xpId, runId) => ask(['run', xpId, runId, 'current_trial']),
    postTrialResults: (experimentId, runId, blockNumber, trialNumber, data) =>
      send(['trial', experimentId, runId, blockNumber, trialNumber], data),
    postExperimentDesign: expeDesign => send('import', expeDesign, 'text/xml')
  };
}
