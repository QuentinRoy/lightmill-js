// Partition an array in function of a criterium.
const partition = (array, keyOrGetKey) => {
  const getKey = typeof keyOrGetKey === 'string'
    ? o => o[keyOrGetKey]
    : keyOrGetKey;
  return array.reduce((acc, val) => {
    const valKey = getKey(val);
    acc[valKey] = acc[valKey] || [];
    acc[valKey].push(val);
    return acc;
  }, {});
};

// Records on going promises and there resolution. Flush can be used to wait for less than a given
// number of promises.
export default function PromiseQueue() {
  if (!(this instanceof PromiseQueue)) {
    throw new Error('PromiseQueue must be called with new.');
  }
  let length = 0;
  let callbacks = [];

  const onResolved = () => {
    length -= 1;
    const { resolved = [], unresolved = [] } = partition(
      callbacks,
      ({ maxLength }) => (maxLength >= length ? 'resolved' : 'unresolved')
    );
    resolved.forEach(({ callback }) => {
      callback();
    });
    callbacks = unresolved;
  };

  /**
   * The current number of pending promises in the queue.
   * @type {int}
   */
  Object.defineProperty(this, 'length', { get: () => length });

  /**
   * Push one or more promises in the queue.
   * @param  {...Promise} promises
   */
  this.push = (...promises) => {
    length += promises.length;
    promises.forEach(promise => {
      promise.then(onResolved, onResolved);
    });
  };

  /**
   * Return a promise that resolves when the number of pending promises in the queue is less or
   * equal to a given number. Resolves immediately if it is already the case.
   * @param  {Number} [maxLength=0] Max number of pending promises.
   * @return {Promise}
   */
  this.flush = (maxLength = 0) => {
    if (length <= maxLength) return Promise.resolve();
    let entry = callbacks.find(e => e.maxLength === maxLength);
    if (!entry) {
      entry = { maxLength };
      entry.promise = new Promise(resolve => {
        entry.callback = resolve;
      });
      callbacks.push(entry);
    }
    return entry.promise;
  };
}
