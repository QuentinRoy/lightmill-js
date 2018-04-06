/* globals document */

import end from '../end';

let node;
beforeEach(() => {
  node = document.createElement('div');
  node.innerHTML = '<div>Foo</div>';
});

describe('Waiting view', () => {
  it('can be shown', () => {
    end(node, 'message');
    expect(node).toMatchSnapshot();
  });

  it('can be removed', () => {
    const { remove } = end(node, 'message');
    remove();
    expect(node).toMatchSnapshot();
  });
});
