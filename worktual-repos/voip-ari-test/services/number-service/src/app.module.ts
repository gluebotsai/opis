import { Module } from '@nestjs/common';
import { NumberController } from './controllers/number.controller';
import { NumberService } from './services/number.service';

@Module({
  controllers: [NumberController],
  providers: [NumberService],
})
export class AppModule {}
