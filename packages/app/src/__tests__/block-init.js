/* globals document */

import simulant from 'simulant';
import initBlock from '../block-init';

let node;
let createView;
beforeEach(() => {
  node = document.createElement('div');
  node.innerHTML = '<div>Foo</div>';
  createView = () =>
    initBlock(node, {
      number: 10,
      measuredBlockNum: 5,
      practice: false,
      factorValues: [
        { factor: { name: 'mock-factor-name' }, name: 'mock-factor-value-name' }
      ]
    });
});

describe('Block view', () => {
  it('can be shown', () => {
    createView();
    expect(node).toMatchSnapshot();
  });

  it('can be removed programmatically', () => {
    createView().remove();
    expect(node).toMatchSnapshot();
  });

  it('is removed when clicked', async () => {
    createView();
    await simulant.fire(node.querySelector('.lightmill-base-app'), 'click');
    expect(node).toMatchSnapshot();
  });

  it('the returned promises resolves when it is removed', async () => {
    let resolved = false;
    const blockViewProm = createView();
    blockViewProm.then(() => {
      resolved = true;
    });

    // Sanity check to make sure the promise does not resolve prematurely.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    await blockViewProm.remove();
    expect(resolved).toBe(true);
  });

  it('the returned promises resolves when it is clicked', async () => {
    let resolved = false;
    createView().then(() => {
      resolved = true;
    });

    // Sanity check to make sure the promise does not resolve prematurely.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(resolved).toBe(false);

    await simulant.fire(node.querySelector('.lightmill-base-app'), 'click');
    expect(resolved).toBe(true);
  });
});
