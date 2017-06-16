import template from './crash.pug';

export default class CrashView {
  constructor(parentDiv) {
    this.parentDiv = parentDiv;
    this.template = template;
  }
  show(run, message, error) {
    const div = document.createElement('div');
    div.innerHTML = this.template({ run, message, stack: error.stack });
    const detailsButton = div.querySelector('.details-button');
    detailsButton.addEventListener('click', (evt) => {
      evt.preventDefault();
      div.querySelector('.details').style.display = 'inherit';
      detailsButton.style.display = 'none';
    });
    this.parentDiv.appendChild(div);
  }
}
