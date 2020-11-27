import { StreamHandler } from "./StreamHandler";
import { GrpcClient } from "../GrpcClient";
import { WeChatLongLinkProxy } from "./WeChatLongLinkProxy";
import {
  LongLinkMessage,
  LongLinkMessagePushType,
  WeChatPushSubscribeResponse,
  WeChatStreamRequest,
  WeChatStreamResponse,
} from "../proto/padlocal_pb";

export class PushStreamHandler extends StreamHandler {
  private readonly _longLinkProxy: WeChatLongLinkProxy;
  private _pushTypeList?: Array<LongLinkMessagePushType>;
  private readonly _pushHandler: (pushMessageList: LongLinkMessage[]) => void;

  constructor(grpcClient: GrpcClient, longLinkProxy: WeChatLongLinkProxy) {
    super(grpcClient);

    this._longLinkProxy = longLinkProxy;

    this._pushHandler = async (pushMessageList: LongLinkMessage[]) => {
      const filteredPushPacketList = pushMessageList.filter((message) => {
        return this._pushTypeList?.indexOf(message.getPush()!.getType()) !== -1;
      });

      if (!filteredPushPacketList.length) {
        return;
      }

      const responseReply = await this.sendResponse(
        new WeChatStreamResponse().setPushsubscriberesponse(
          new WeChatPushSubscribeResponse().setMessageList(filteredPushPacketList)
        )
      );

      if (responseReply.getEof()) {
        this._longLinkProxy.removeListener("push", this._pushHandler);
      }
    };
  }

  onRequest(wechatStreamRequest: WeChatStreamRequest): void {
    const pushSubscribeRequest = wechatStreamRequest.getPushsubscriberequest()!;

    this._pushTypeList = pushSubscribeRequest.getPushtypeList();
    this._longLinkProxy.removeListener("push", this._pushHandler);
    this._longLinkProxy.on("push", this._pushHandler);
  }
}
