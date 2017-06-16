import Spinner from 'spin';

const spinnerArgs = {
  lines: 11, // The number of lines to draw
  length: 20, // The length of each line
  width: 10, // The line thickness
  radius: 30, // The radius of the inner circle
  corners: 1, // Corner roundness (0..1)
  rotate: 0, // The rotation offset
  direction: 1, // 1: clockwise, -1: counterclockwise
  color: 'white', // #rgb or #rrggbb or array of colors
  speed: 1, // Rounds per second
  trail: 60, // Afterglow percentage
  shadow: false, // Whether to render a shadow
  hwaccel: false, // Whether to use hardware acceleration
  className: 'spinner', // The CSS class to assign to the spinner
  zIndex: 2e9, // The z-index (defaults to 2000000000)
  top: 'auto', // Top position relative to parent in px
  left: 'auto' // Left position relative to parent in px
};

export default class WaitView {
  constructor(parentNode) {
    this._parentNode = parentNode;
    this._spinDiv = document.createElement('div');
    Object.assign(this._spinDiv.style, {
      position: 'absolute',
      width: '100%',
      height: '100%',
      margin: 0,
      padding: 0,
      top: 0,
      left: 0
    });
    this._spinDiv.style.backgroundColor = 'black';
    this._spinner = new Spinner(spinnerArgs);
    this._isShown = false;
  }
  show() {
    if (!this.isShown) {
      this._parentNode.appendChild(this._spinDiv);
      this._spinner.spin(this._spinDiv);
      this._isShown = true;
    }
  }
  hide() {
    if (this.isShown) {
      this._spinner.stop();
      if (this._parentNode.contains(this._spinDiv)) {
        this._parentNode.removeChild(this._spinDiv);
      }
      this._isShown = false;
    }
  }
  get isShown() {
    return this._isShown;
  }
}
