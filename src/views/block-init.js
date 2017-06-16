import template from './block-init.pug';

export default class BlockInitView {
  constructor(parentDiv) {
    this.parentDiv = parentDiv;
    this.template = template;
    this.practiceColor = '#079649';
    this.measuredColor = '#A9352C';
  }
  show(blockinfo) {
    return new Promise((resolve) => {
      const parentDiv = this.parentDiv;
      const blockDiv = document.createElement('div');
      blockDiv.innerHTML = this.template({
        first: blockinfo.number === 0,
        name: blockinfo.practice ? 'Practice' : `Block ${blockinfo.measuredBlockNumber + 1}`,
        factorValues: blockinfo.factorValues,
        subjectiveAssessment: blockinfo.subjectiveAssessment,
        backgroundColor: blockinfo.practice ? this.practiceColor : this.measuredColor
      });
      parentDiv.appendChild(blockDiv);
      blockDiv.addEventListener('click', () => {
        parentDiv.removeChild(blockDiv);
        resolve();
      });
    });
  }
}
