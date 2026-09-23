import { createRunnerApi } from './api';
import { LocalGenerationRunner } from './runner';
import { RunnerSingletonLock } from './service';

const runner = new LocalGenerationRunner();
const lock = new RunnerSingletonLock(runner.stateRoot);
lock.acquire();
const server = createRunnerApi(runner);

const shutdown = () => {
  server.close(() => {
    runner.close();
    lock.release();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (reason) => {
  console.error(reason);
  shutdown();
});

server.listen(runner.port, runner.address, () => {
  console.log(JSON.stringify({ event: 'runner-listening', ...runner.capabilities(), stateDatabase: runner.store.path }));
});
