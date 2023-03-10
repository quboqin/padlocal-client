import { WeChatStreamRequest, WeChatStreamResponse, WeChatStreamResponseReply } from "../proto/padlocal_pb";
import { Request, SubResponse } from "../Request";

export abstract class StreamHandler {
  protected readonly _request: Request;
  private _ack?: number;

  protected constructor(request: Request) {
    this._request = request;
  }

  public async handleRequest(wechatStreamRequest: WeChatStreamRequest, ack: number): Promise<void> {
    this._ack = ack;

    while (true) {
      this.onRequest(wechatStreamRequest);

      if (wechatStreamRequest.getEof()) {
        break;
      }

      const response: SubResponse<WeChatStreamRequest> = await this._request.subReplyAndRequest(
        this._ack!,
        new WeChatStreamResponse()
      );

      wechatStreamRequest = response.payload;
      this._ack = response.ack;
    }
  }

  /**
   * return true: eof
   * @param wechatStreamResponse
   */
  public async sendResponse(wechatStreamResponse: WeChatStreamResponse): Promise<WeChatStreamResponseReply> {
    const response: SubResponse<WeChatStreamResponseReply> = await this._request.subReplyAndRequest(
      this._ack!,
      wechatStreamResponse
    );

    const wechatResponseReply = response.payload;
    if (!wechatResponseReply.getEof()) {
      this._ack = response.ack!;
    }

    return wechatResponseReply;
  }

  abstract onRequest(wechatRequest: WeChatStreamRequest): void;
}
