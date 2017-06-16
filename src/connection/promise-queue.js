// Partition an array in function of a criterium.
const partition = (array, keyOrGetKey) => {
  const getKey = typeof keyOrGetKey === 'string' ? o => o[keyOrGetKey] : keyOrGetKey;
  return array.reduce((acc, val) => {
    const valKey = getKey(val);
    acc[valKey] = acc[valKey] || [];
    acc[valKey].push(val);
    return acc;
  }, {});
};

// Records on going promises and there resolution. Flush can be used to wait for less than a given
// number of promises.
export default class PromiseQueue {
  constructor() {
    this._length = 0;
    this._callbacks = [];
    // Protect this._resolved.
    this._resolved = this._resolved.bind(this);
  }
  get length() {
    return this._length;
  }
  get last() {
    return this._last;
  }
  _resolved() {
    this._length -= 1;
    const { resolved = [], unresolved = [] } = partition(
      this._callbacks,
      ({ length }) => (length >= this._length ? 'resolved' : 'unresolved')
    );
    resolved.forEach(({ callback }) => {
      callback();
    });
    this._callbacks = unresolved;
  }
  push(...promises) {
    this._length += promises.length;
    this._last = promises[promises.length - 1];
    promises.forEach((promise) => {
      promise.then(this._resolved, this._resolved);
    });
  }
  flush(length = 0) {
    if (this._length <= length) return Promise.resolve();
    let entry = this._callbacks.find(e => e.length === length);
    if (!entry) {
      entry = { length };
      entry.promise = new Promise((resolve) => {
        entry.callback = resolve;
      });
      this._callbacks.push(entry);
    }
    return entry.promise;
  }
}
