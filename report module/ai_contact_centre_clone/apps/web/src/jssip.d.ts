declare module "jssip" {
  export class WebSocketInterface {
    constructor(url: string);
  }

  export class UA {
    constructor(configuration: Record<string, unknown>);
    start(): void;
    stop(): void;
    unregister(): void;
    call(target: string, options?: Record<string, unknown>): {
      terminate(): void;
      connection?: RTCPeerConnection;
      on(event: string, handler: (event: unknown) => void): void;
    };
    on(event: string, handler: (event: unknown) => void): void;
  }

  const JsSIP: {
    WebSocketInterface: typeof WebSocketInterface;
    UA: typeof UA;
  };
  export default JsSIP;
}
