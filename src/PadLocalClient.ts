import { Request } from "./Request";
import {Contact, Message, ServerInfo, SyncEvent, SyncRequestScene, SystemEventRequest} from "./proto/padlocal_pb";
import { Status, StatusEventPayload, WeChatLongLinkProxy } from "./link/WeChatLongLinkProxy";
import { EventEmitter } from "events";
import { PadLocalClientApi } from "./PadLocalClientApi";
import { Message as GrpcMessage } from "google-protobuf";
import { VERSION } from "./version";
import { GrpcClient, GrpcOptions } from "./GrpcClient";
import { getServerInfo } from "./utils/ServerInfo";
import {HostResolver} from "./utils/Host";
import Log from "./utils/Log";

export type PadLocalClientEvent = "kickout" | "contact" | "message";

const LOGPRE = "[PadLocalClient]";

export class PadLocalClient extends EventEmitter {
  readonly grpcClient: GrpcClient;
  readonly token: string;

  private readonly _longLinkProxy: WeChatLongLinkProxy;
  selfContact?: Contact;

  readonly api: PadLocalClientApi = new PadLocalClientApi(this);

  emit(event: "kickout", detail: KickOutEvent): boolean;
  emit(event: "contact", contactList: Contact[]): boolean;
  emit(event: "message", messageList: Message[]): boolean;

  emit(event: PadLocalClientEvent, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  public static async create(token: string, skipPrintVersion: boolean = false): Promise<PadLocalClient> {
    let serverInfo:ServerInfo;
    try {
      serverInfo = await getServerInfo(token);
    }catch (e) {
      Log.error(LOGPRE, `Fail to get server info: ${e}`);
      throw e;
    }

    return new PadLocalClient(
      `${serverInfo.getHost()!.getHost()}:${serverInfo.getHost()!.getPort()}`,
      serverInfo.getPdltoken(),
      Buffer.from(serverInfo.getServerca()),
      skipPrintVersion
    );
  }

  private constructor(serverAddr: string, token: string, serverCA?: Buffer, skipPrintVersion: boolean = false) {
    super();
    this.grpcClient = new GrpcClient(serverAddr, token, serverCA);
    this.token = token;

    this._longLinkProxy = new WeChatLongLinkProxy(this);

    this._longLinkProxy.on("message-push", async () => {
      try {
        const syncEvent = await this.api.sync(SyncRequestScene.ON_PUSH);

        this._processSyncResponse(syncEvent);
      } catch (e) {
        Log.error(LOGPRE, `error while syncing onpush: ${e.stack}`);
      }
    });

    this._longLinkProxy.on("status", async (detail: StatusEventPayload) => {
      if (detail.newStatus == Status.CONNECTED) {
        if (this.isOnline) {
          try {
            const syncEvent = await this.api.sync(SyncRequestScene.LONGLINK_INIT);
            this._processSyncResponse(syncEvent);
          } catch (e) {
            Log.error(LOGPRE, `error while syncing after longlink connected: ${e.stack}`);
          }
        }
      }
    });

    if (!skipPrintVersion) {
      Log.info(
        `
      ============================================================
                    Welcome to padlocal-client-ts !
                           version: ${this.version}
      ============================================================
     `
      );
    }
  }

  get isOnline(): boolean {
    return !!this.selfContact;
  }

  get version(): string {
    return VERSION;
  }

  isSelf(userName: string): boolean {
    return this.selfContact?.getUsername() === userName;
  }

  createRequest(options?: Partial<GrpcOptions>): Request {
    const ret = new Request(this, options);

    ret.onSystemEventCallback = (systemEventRequest: SystemEventRequest) => {
      if (systemEventRequest.getPayloadCase() === SystemEventRequest.PayloadCase.KICKOUTEVENT) {
        this._reset();

        this.emit("kickout", {
          errorCode: systemEventRequest.getKickoutevent()!.getErrorcode(),
          errorMessage: systemEventRequest.getKickoutevent()!.getErrormessage(),
        });

        this._longLinkProxy.shutdown(true);
      } else if (systemEventRequest.getPayloadCase() === SystemEventRequest.PayloadCase.LONGLINKUPDATEEVENT) {
        const longLinkUpdateEvent = systemEventRequest.getLonglinkupdateevent()!;
        if (longLinkUpdateEvent.getLonglinkhostlistList()?.length) {
          const hostList = HostResolver.hostListFromPBHost(longLinkUpdateEvent.getLonglinkhostlistList());
          this._longLinkProxy.updateHostList(hostList);
        }

        // reconnect only while longlink is not idle or ordered by server
        if (!this._longLinkProxy.isIdle() || longLinkUpdateEvent.getReconnectimmediately()) {
          Log.silly(LOGPRE, "reset long link");
          this.getLongLinkProxy(true).then();
        }
      } else if (systemEventRequest.getPayloadCase() === SystemEventRequest.PayloadCase.NOTICEEVENT) {
        const noticeEvent = systemEventRequest.getNoticeevent()!;
        Log.warn(LOGPRE, noticeEvent.getNotice());
      }
    };

    return ret;
  }

  async request<REQ extends GrpcMessage, RES extends GrpcMessage>(
    request: REQ,
    options?: Partial<GrpcOptions>
  ): Promise<RES> {
    return this.createRequest(options).request(request);
  }

  async getLongLinkProxy(reset?: boolean): Promise<WeChatLongLinkProxy> {
    if (reset) {
      await this._longLinkProxy.reconnect();
      return this._longLinkProxy;
    } else {
      await this._longLinkProxy.makeSureConnected();
      return this._longLinkProxy;
    }
  }

  getLongLinkProxyDirect() {
    return this._longLinkProxy;
  }

  public getLongLinkId(): string | undefined {
    return this._longLinkProxy.getId();
  }

  public async shutdown() {
    this._reset();

    await this.api
      .sendClientStopSignal()
      .then()
      .catch(() => {});
  }

  private _reset(): void {
    this.selfContact = undefined;
    this._longLinkProxy.shutdown(true);
  }

  private _processSyncResponse(syncEvent: SyncEvent): void {
    Log.silly(
      LOGPRE,
      `on push notification, contact count:${syncEvent.getContactList().length}, message count:${
        syncEvent.getMessageList().length
      }`
    );

    if (syncEvent.getMessageList().length > 0) {
      this.emit("message", syncEvent.getMessageList());
    }

    if (syncEvent.getContactList().length > 0) {
      this.emit("contact", syncEvent.getContactList());
    }
  }
}

export interface KickOutEvent {
  readonly errorCode: number;
  readonly errorMessage: string;
}

export { Log }
