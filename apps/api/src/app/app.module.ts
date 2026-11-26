import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ProvidersModule } from '../providers/providers.module';

@Module({
  imports: [ConfigModule, ProvidersModule],
})
export class AppModule {}
