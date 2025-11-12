// 🎨 Type-safe WebSocket message system
interface BaseMessage {
  type: string;
  timestamp: number;
  id: string;
}

interface ChatMessage extends BaseMessage {
  type: "chat_message";
  content: string;
  userId: string;
  username: string;
}

interface UserJoinedMessage extends BaseMessage {
  type: "user_joined";
  userId: string;
  username: string;
}

interface UserLeftMessage extends BaseMessage {
  type: "user_left";
  userId: string;
  username: string;
}

interface TypingMessage extends BaseMessage {
  type: "typing";
  userId: string;
  username: string;
  isTyping: boolean;
}

// 🎯 Union type for all possible messages
type WebSocketMessage = ChatMessage | UserJoinedMessage | UserLeftMessage | TypingMessage;

// 🏗️ Advanced WebSocket client with full TypeScript support
interface WebSocketClientConfig {
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
  connectionTimeout?: number;
}

interface WebSocketClientEvents {
  connected: () => void;
  disconnected: (reason: string) => void;
  message: (message: WebSocketMessage) => void;
  error: (error: Error) => void;
  reconnecting: (attempt: number) => void;
}

export class TypeSafeWebSocketClient {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private heartbeatTimer: number | null = null;
  private connectionTimeoutTimer: number | null = null;
  private eventListeners: Partial<WebSocketClientEvents> = {};

  constructor(
    private url: string,
    private config: WebSocketClientConfig = {},
  ) {
    // 🎛️ Default configuration
    this.config = {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      reconnectDelay: 1000,
      heartbeatInterval: 30000,
      connectionTimeout: 10000,
      ...config,
    };
  }

  // 🎧 Event listener management
  on<K extends keyof WebSocketClientEvents>(event: K, listener: WebSocketClientEvents[K]): void {
    this.eventListeners[event] = listener;
  }

  off<K extends keyof WebSocketClientEvents>(event: K): void {
    delete this.eventListeners[event];
  }

  private emit<K extends keyof WebSocketClientEvents>(
    event: K,
    ...args: Parameters<NonNullable<WebSocketClientEvents[K]>>
  ): void {
    const listener = this.eventListeners[event];
    if (listener) {
      (listener as any)(...args);
    }
  }

  // 🔌 Connection management
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log("🔌 Initiating WebSocket connection...");

      try {
        this.socket = new WebSocket(this.url);
        this.setupEventHandlers(resolve, reject);
      } catch (error) {
        this.clearConnectionTimeout();
        reject(error);
      }
    });
  }

  private setupEventHandlers(resolve: () => void, reject: (error: Error) => void): void {
    if (!this.socket) return;

    this.socket.onopen = () => {
      console.log("✅ WebSocket connected successfully!");
      this.clearConnectionTimeout();
      this.reconnectAttempts = 0;
      this.emit("connected");
      resolve();
    };

    this.socket.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        // 💓 Handle heartbeat responses
        if (message.type === "pong") {
          console.log("💓 Heartbeat response received");
          return;
        }

        console.log("📨 Message received:", message.type);
        console.log("📨 Message received:", message);
        this.emit("message", message);
      } catch (error) {
        console.error("❌ Failed to parse message:", error);
        this.emit("error", new Error("Failed to parse message"));
      }
    };

    this.socket.onclose = (event) => {
      console.log(`🔌 WebSocket closed: ${event.code} - ${event.reason}`);
      this.cleanup();
      this.emit("disconnected", event.reason);

      if (this.config.autoReconnect && event.code !== 1000) {
        this.attemptReconnect();
      }
    };

    this.socket.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      this.clearConnectionTimeout();
      this.emit("error", new Error("WebSocket connection error"));
      reject(new Error("WebSocket connection error"));
    };
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // 🔄 Reconnection logic
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 5)) {
      console.error("💥 Max reconnection attempts exceeded");
      return;
    }

    this.reconnectAttempts++;
    const delay = (this.config.reconnectDelay || 1000) * this.reconnectAttempts;

    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    this.emit("reconnecting", this.reconnectAttempts);

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error("❌ Reconnection failed:", error);
      });
    }, delay);
  }

  // 📤 Message sending with type safety
  send<T extends WebSocketMessage>(message: T): boolean {
    if (!this.isConnected()) {
      console.warn("⚠️ Cannot send message: WebSocket not connected");
      return false;
    }

    try {
      this.socket!.send(JSON.stringify(message));
      console.log("📤 Message sent:", message.type);
      return true;
    } catch (error) {
      console.error("❌ Failed to send message:", error);
      this.emit("error", new Error("Failed to send message"));
      return false;
    }
  }

  // 🔍 Connection state
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  getReadyState(): string {
    if (!this.socket) return "DISCONNECTED";

    switch (this.socket.readyState) {
      case WebSocket.CONNECTING:
        return "CONNECTING";
      case WebSocket.OPEN:
        return "OPEN";
      case WebSocket.CLOSING:
        return "CLOSING";
      case WebSocket.CLOSED:
        return "CLOSED";
      default:
        return "UNKNOWN";
    }
  }

  // 🧹 Cleanup
  private clearConnectionTimeout(): void {
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.clearConnectionTimeout();
  }

  // 🔌 Disconnect
  disconnect(code = 1000, reason = "Client disconnect"): void {
    if (this.socket) {
      console.log("🔌 Disconnecting WebSocket...");
      this.config.autoReconnect = false; // Prevent auto-reconnect
      this.socket.close(code, reason);
    }
    this.cleanup();
  }
}
