import { Test } from '@nestjs/testing';
import { ScanningHttpModule } from '@modules/scanning/index.js';
import { WorkerModule } from './worker.module.js';

describe('WorkerModule', () => {
  it('compiles with the core and job modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(moduleRef.get(WorkerModule)).toBeInstanceOf(WorkerModule);
    await moduleRef.close();
  });

  it('does not load any HTTP module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(() => moduleRef.get(ScanningHttpModule)).toThrow();
    await moduleRef.close();
  });
});
