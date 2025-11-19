export interface WebSocket {
  connect(): Promise<void>;
  onError(error: ErrorEvent): Promise<void>;
}
