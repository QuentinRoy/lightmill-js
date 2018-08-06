import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import convert from './convert-touchstone';

const TEST_DATA_PATH = path.join(
  __dirname,
  '__fixtures__/convert-touchstone.test.xml'
);

const readFile = promisify(fs.readFile);

describe('convert', async () => {
  it('accepts read stream as input', async () => {
    await expect(
      convert(fs.createReadStream(TEST_DATA_PATH))
    ).resolves.toMatchSnapshot();
  });
  it('accepts strings as input', async () => {
    const buffer = await readFile(TEST_DATA_PATH);
    await expect(convert(buffer.toString())).resolves.toMatchSnapshot();
  });
  it("block and trial's type can be changed", async () => {
    await expect(
      convert(fs.createReadStream(TEST_DATA_PATH), {
        blockStartupType: 'mock-block-startup',
        trialType: 'mock-trial'
      })
    ).resolves.toMatchSnapshot();
  });
  it('block startups can be disabled', async () => {
    await expect(
      convert(fs.createReadStream(TEST_DATA_PATH), {
        blockStartupType: false
      })
    ).resolves.toMatchSnapshot();
  });
});
