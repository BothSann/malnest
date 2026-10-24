import { Module } from '@nestjs/common';
import { IdentityModule, IdentityHttpModule } from '@modules/identity/index.js';
import { ScanningModule, ScanningHttpModule } from '@modules/scanning/index.js';
import { WebhooksModule, WebhooksHttpModule } from '@modules/webhooks/index.js';
import { SharedModule } from './shared/shared.module.js';

@Module({
  imports: [
    SharedModule,
    IdentityModule,
    IdentityHttpModule,
    ScanningModule,
    ScanningHttpModule,
    WebhooksModule,
    WebhooksHttpModule,
  ],
})
export class ApiModule {}
