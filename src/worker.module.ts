import { Module } from '@nestjs/common';
import { IdentityModule } from '@modules/identity/index.js';
import { ScanningModule, ScanningJobsModule } from '@modules/scanning/index.js';
import { WebhooksModule, WebhooksJobsModule } from '@modules/webhooks/index.js';
import { SharedModule } from './shared/shared.module.js';

@Module({
  imports: [
    SharedModule,
    IdentityModule,
    ScanningModule,
    ScanningJobsModule,
    WebhooksModule,
    WebhooksJobsModule,
  ],
})
export class WorkerModule {}
