// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from "n8n-workflow";

/** Shared by every ScreenPipe node: where ScreenPipe's local API runs and its API key. */
export class ScreenPipeApi implements ICredentialType {
  name = "screenpipeApi";
  displayName = "ScreenPipe API";
  icon = "file:screenpipe.png" as const;
  documentationUrl = "https://docs.screenpi.pe";

  properties: INodeProperties[] = [
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      // n8n runs in Docker; ScreenPipe listens on the host.
      default: "http://host.docker.internal:3030",
      description: "URL of the ScreenPipe local API, as seen from n8n",
    },
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description: "ScreenPipe local API key (ScreenPipe → Settings). Leave empty if API auth is off.",
    },
  ];

  // Used by n8n's "Test" button; the node sets the same header itself.
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: { Authorization: '={{ $credentials.apiKey ? "Bearer " + $credentials.apiKey : undefined }}' },
    },
  };

  test: ICredentialTestRequest = {
    request: { baseURL: "={{ $credentials.baseUrl.replace(/\\/+$/, '') }}", url: "/search", qs: { limit: 1 } },
  };
}
