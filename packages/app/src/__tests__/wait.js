/* globals document */

import wait from '../wait';

let node;
beforeEach(() => {
  node = document.createElement('div');
  node.innerHTML = '<div>Foo</div>';
});

describe('Waiting view', () => {
  it('can be shown', () => {
    wait(node, 'message');
    expect(node).toMatchSnapshot();
  });
  it('can be removed', () => {
    const { remove } = wait(node, 'message');
    remove();
    expect(node).toMatchSnapshot();
  });
});
