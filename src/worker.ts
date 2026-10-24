import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerModule);
  new Logger('Worker').log('Worker ready!');
}

await bootstrap();
