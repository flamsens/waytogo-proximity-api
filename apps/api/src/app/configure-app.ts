import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { AppConfig } from '../config/app-config';

/**
 * HTTP-level setup shared by `main.ts` and the HTTP tests, so tests exercise the
 * same validation, CORS, compression and docs as production.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  // Behind the VM's reverse proxy, take the client IP from X-Forwarded-For (rate limiting).
  (app as NestExpressApplication).set('trust proxy', config.trustProxy);
  app.enableCors({ origin: '*' });
  app.use(compression());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Shared-mobility proximity API')
      .setDescription(
        [
          'How many shared cars, bicycles, cargo bikes and scooters are available near a point in Belgium.',
          '',
          '- `radius` (1–1000 m) applies to all vehicles; optional `carRadius` (1–1000 m) to cars only.',
          '- Counts are a live snapshot, refreshed hourly by default; `data.ageSeconds` tells how old.',
          '- `503` means data is not loaded yet (retry later); `429` means the per-IP rate limit',
          '  (120/min, batch 30/min) was exceeded.',
          '- No authentication. Full guide: `docs/api.md` in the repository.',
        ].join('\n'),
      )
      .setVersion('1')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
}
