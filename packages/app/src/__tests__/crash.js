/* globals document */

import simulant from 'simulant';
import crash from '../crash';

let node;
let err;
beforeEach(() => {
  node = document.createElement('div');
  node.innerHTML = '<div>Foo</div>';
  err = new Error('error message');
  err.stack = ['err stack'];
});

describe('Waiting view', () => {
  it('can be shown', () => {
    crash(node, 'message', err);
    expect(node).toMatchSnapshot();
  });
  it('can be removed', () => {
    const { remove } = crash(node, 'message', err);
    remove();
    expect(node).toMatchSnapshot();
  });
  it('can display additional details on the error', () => {
    crash(node, 'message', err);
    simulant.fire(node.querySelector('.lightmill-details-button'), 'click');
    expect(node).toMatchSnapshot();
  });
});
