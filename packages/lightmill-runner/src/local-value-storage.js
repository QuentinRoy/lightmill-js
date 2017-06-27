/**
 * Represents a value stored in the local storage.
 */
export default class LocalValueStorage {
  /**
   * @param  {string} key the key of the value in the local storage.
   */
  constructor(key) {
    /**
     * The key of the value in the local storage.
     * @type {string}
     */
    this.key = key;
  }
  /**
   * @return {string?} the stored value
   */
  get() {
    return localStorage.getItem(this.key);
  }
  /**
   * @param {string} value the value to store
   */
  set(value) {
    localStorage.setItem(this.key, value);
  }
  /**
   * Remove the value.
   */
  remove() {
    localStorage.removeItem(this.key);
  }
}
