import wait from 'wait-then';
import { isExperimentLoadedOnServer } from '../server-interface';

describe('isExperimentLoadedOnServer', async () => {
  it('checks if the experiment is available on the server', async () => {
    // Mock the server interface.
    const server = {
      experiments: jest.fn(() => wait(0).then(() => ({ xp1: {}, xp2: {} })))
    };
    expect(await isExperimentLoadedOnServer(server, 'xp1')).toBe(true);
    expect(server.experiments).toMatchSnapshot();
    expect(await isExperimentLoadedOnServer(server, 'not-here')).toBe(false);
    expect(server.experiments).toMatchSnapshot();
  });
});
