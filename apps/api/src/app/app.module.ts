import { Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config/app-config';

@Module({
  imports: [],
  controllers: [],
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }],
})
export class AppModule {}
