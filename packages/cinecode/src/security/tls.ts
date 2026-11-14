export interface TlsEnforcementOptions {
  allowInsecureHttp?: boolean;
  trustedCAs?: string[];
}

export class TlsEnforcer {
  static validateUrl(urlStr: string, options: TlsEnforcementOptions = {}): URL {
    const parsed = new URL(urlStr);

    if (parsed.protocol === "http:" && !options.allowInsecureHttp) {
      throw new Error(`CC8005: Insecure HTTP media source rejected for '${urlStr}'. Use HTTPS or pass --allow-insecure-http.`);
    }

    return parsed;
  }

  static getFetchInit(options: TlsEnforcementOptions = {}): RequestInit {
    return {};
  }
}
