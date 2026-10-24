import { Test } from '@nestjs/testing';
import { ApiModule } from './api.module.js';

describe('ApiModule', () => {
  it('compiles with every context core and HTTP module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    expect(moduleRef.get(ApiModule)).toBeInstanceOf(ApiModule);
    await moduleRef.close();
  });
});
