/** Raised when sdk-gateway rejects or fails a call — carries the HTTP status so callers can distinguish "denied" (403/404, e.g. RLS filtered the row) from "broken" (5xx). */
export class SdkGatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "SdkGatewayError";
  }
}
