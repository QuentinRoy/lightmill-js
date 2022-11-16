import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import convert from './convert-touchstone.mjs';

const TEST_DATA_PATH = path.join(
  __dirname,
  '__fixtures__/convert-touchstone.test.xml'
);

const readFile = promisify(fs.readFile);

describe('convert', () => {
  let fixture;
  beforeAll(async () => {
    fixture = (await readFile(TEST_DATA_PATH)).toString();
  });

  it('accepts read stream as input', async () => {
    await expect(
      convert(fs.createReadStream(TEST_DATA_PATH))
    ).resolves.toMatchSnapshot();
  });
  it('accepts strings as input', async () => {
    await expect(convert(fixture)).resolves.toMatchSnapshot();
  });
  it('pres, posts, and trials options can be specified as strings', async () => {
    await expect(
      convert(fixture, {
        trials: 'mock-trial',
        preRuns: 'mock-pre-run',
        postRuns: 'mock-post-run',
        preBlocks: 'mock-pre-block',
        postBlocks: 'mock-post-block'
      })
    ).resolves.toMatchSnapshot();
  });
  it('pres, posts, and trials options can be specified as functions', () => {
    let i = -1;
    const getI = () => {
      i += 1;
      return i;
    };
    const trials = jest.fn(() => ({ type: 'mock-trial', i: getI() }));
    const preRuns = jest.fn(() => ({ type: 'mock-pre-run', i: getI() }));
    const postRuns = jest.fn(() => ({ type: 'mock-post-run', i: getI() }));
    const preBlocks = jest.fn(() => ({ type: 'mock-pre-block', i: getI() }));
    const postBlocks = jest.fn(() => ({ type: 'mock-post-block', i: getI() }));
    expect(
      convert(fixture, { preRuns, postRuns, preBlocks, postBlocks, trials })
    ).resolves.toMatchSnapshot();
    expect(trials).toMatchSnapshot('trials');
    expect(preRuns).toMatchSnapshot('preRuns');
    expect(postRuns).toMatchSnapshot('postRuns');
    expect(preBlocks).toMatchSnapshot('preBlocks');
    expect(postBlocks).toMatchSnapshot('postBlocks');
  });
  it('pres, posts, and trials options can be specified as objects', () => {
    expect(
      convert(fixture, {
        trials: { type: 'mock-trial' },
        preRuns: { type: 'mock-pre-run' },
        postRuns: { type: 'mock-post-run' },
        preBlocks: { type: 'mock-pre-block' },
        postBlocks: { type: 'mock-post-block' }
      })
    ).resolves.toMatchSnapshot();
  });
  it('pres, posts, and trials can be specified as arrays of objects', () => {
    expect(
      convert(fixture, {
        trials: [{ type: 'trial-1' }, { type: 'trial-2' }],
        preRuns: [{ type: 'pre-run-1' }, { type: 'pre-run-2' }],
        postRuns: [{ type: 'post-run-1' }, { type: 'post-run-2' }],
        preBlocks: [{ type: 'pre-block-1' }, { type: 'pre-block-2' }],
        postBlocks: [{ type: 'post-block-1' }, { type: 'post-block-2' }]
      })
    ).resolves.toMatchSnapshot();
  });
  it('pres, posts, and trials options can be specified as arrays of strings', () => {
    expect(
      convert(fixture, {
        trials: ['trial-1', 'trial-2'],
        preRuns: ['pre-run-1', 'pre-run-2'],
        postRuns: ['post-run-1', 'post-run-2'],
        preBlocks: ['pre-block-1', 'pre-block-2'],
        postBlocks: ['post-block-1', 'post-block-2']
      })
    ).resolves.toMatchSnapshot();
  });
});
