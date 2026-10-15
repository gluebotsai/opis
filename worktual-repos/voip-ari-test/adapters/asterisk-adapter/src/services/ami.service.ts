import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as AsteriskAmi from 'asterisk-ami';
import { RedisService } from './redis.service';

@Injectable()
export class AmiService implements OnModuleInit {
  private readonly logger = new Logger(AmiService.name);
  private ami: any;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    const host = process.env.AMI_HOST || 'localhost';
    const port = Number(process.env.AMI_PORT) || 5038;
    const username = process.env.AMI_USER || 'telephony';
    const password = process.env.AMI_PASSWORD || 'telephony_password';

    this.logger.log(`Connecting to Asterisk AMI at ${host}:${port}...`);

    this.ami = new AsteriskAmi({
      port,
      host,
      username,
      password,
      reconnect: true,
      sleep: 5000,
    });

    this.ami.connect();

    this.ami.on('connect', () => {
      this.logger.log('Connected successfully to Asterisk AMI Socket');
    });

    this.ami.on('error', (err: any) => {
      this.logger.error(`AMI Socket Error: ${err}`);
    });

    this.ami.on('eventPeerStatus', (event: any) => {
      this.logger.log(`AMI PeerStatus Event: Peer [${event.peer}] is now ${event.peerstatus}`);
      this.redisService.publish('telephony.events.asterisk', {
        event: 'peer.status_change',
        peer: event.peer,
        peerStatus: event.peerstatus,
        timestamp: new Date().toISOString(),
      });
    });
  }
}
